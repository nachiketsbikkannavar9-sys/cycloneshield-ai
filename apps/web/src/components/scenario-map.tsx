import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import {
  Building2,
  Layers3,
  LocateFixed,
  MapPinned,
  Route,
  ShieldAlert,
  Waves,
  X,
} from "lucide-react";
import type { PolylineOptions } from "leaflet";
import type {
  BoundingBox,
  ImpactZone,
  InfrastructureAsset,
  Scenario,
} from "@cycloneshield/shared";
import {
  bearingDegrees,
  boundsCorners,
  createSmoothPath,
  getInitialViewBounds,
  pathBearingAtRatio,
  pathPointAtRatio,
  type LatLngTuple,
} from "../lib/geo.js";
import {
  criticalityRiskCategory,
  riskCategoryColors,
  riskCategoryLabels,
  riskCategoryOrder,
} from "../lib/risk-colors.js";
import "leaflet/dist/leaflet.css";

type LayerKey = "track" | "impactZones" | "assets";

type ScenarioMapProps = {
  scenario: Scenario;
  assets: InfrastructureAsset[];
  selectedAssetId: string | null;
  onSelectAsset: (asset: InfrastructureAsset) => void;
};

/** Hazard keeps a stroke pattern so it stays readable once fill means severity. */
const hazardDashPatterns: Record<ImpactZone["hazard"], string | undefined> = {
  wind: undefined,
  surge: "10 6",
  rainfall: "4 6",
  flood: "2 7",
  access: "12 5 3 5",
};

const severityFillOpacity = {
  low: 0.07,
  moderate: 0.1,
  high: 0.14,
  critical: 0.2,
} as const;

const ODPISHA_CENTER: LatLngTuple = [20.03, 85.64];

// smoothFactor 0 keeps every Catmull-Rom sample: Leaflet's default 1.0 simplifier
// collapses the curve back into straight 2-vertex segments.
const TRACK_GLOW_OPTIONS: PolylineOptions = {
  color: "#22d3ee",
  weight: 9,
  opacity: 0.16,
  lineCap: "round",
  smoothFactor: 0,
};
const TRACK_CORE_OPTIONS: PolylineOptions = {
  color: "#67e8f9",
  weight: 3,
  opacity: 0.95,
  lineCap: "round",
  smoothFactor: 0,
};

function createChevronIcon(
  bearing: number,
  { size = 14, color = "#67e8f9", stroke = 3 } = {},
): L.DivIcon {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-right:${stroke}px solid ${color};border-top:${stroke}px solid ${color};transform:rotate(${bearing - 45}deg);filter:drop-shadow(0 1px 3px rgb(2 6 23 / 0.95))"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createHaloIcon(): L.DivIcon {
  const size = 44;
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:${size}px;height:${size}px;margin:${-size / 2}px 0 0 ${-size / 2}px;border-radius:9999px;border:2px solid rgb(248 250 252 / 0.45);box-shadow:0 0 0 2px rgb(103 232 249 / 0.25)"></span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

const haloIcon = createHaloIcon();

function FitScenario({
  bounds,
  register,
}: {
  bounds: BoundingBox | null;
  register: (fit: () => void) => void;
}) {
  const map = useMap();

  const fit = useCallback(() => {
    if (!bounds) return;
    const size = map.getSize();
    map.fitBounds(boundsCorners(bounds), {
      padding: [
        Math.round(Math.min(96, Math.max(20, size.y * 0.12))),
        Math.round(Math.min(150, Math.max(20, size.x * 0.12))),
      ],
      maxZoom: 10,
    });
  }, [map, bounds]);

  useEffect(() => {
    fit();
  }, [fit]);

  useEffect(() => {
    register(fit);
  }, [fit, register]);

  // The first fit can run before the surrounding grid has settled, which would
  // lock in a zoom computed for the wrong container size.
  useEffect(() => {
    const container = map.getContainer();
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      fit();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [map, fit]);

  return null;
}


function LayerButton({
  active,
  label,
  icon: Icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: typeof Route;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
        active
          ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
          : "border-white/10 bg-slate-950/70 text-slate-400 hover:border-white/20 hover:text-slate-200"
      }`}
    >
      <Icon size={14} aria-hidden="true" />
      {label}
    </button>
  );
}

export function ScenarioMap({
  scenario,
  assets,
  selectedAssetId,
  onSelectAsset,
}: ScenarioMapProps) {
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    track: true,
    impactZones: true,
    assets: true,
  });
  const [mapError, setMapError] = useState(false);
  const fitScenarioRef = useRef<() => void>(() => {});

  const registerFit = useCallback((fit: () => void) => {
    fitScenarioRef.current = fit;
  }, []);

  const orderedTrackPoints = useMemo(
    () =>
      scenario.trackPoints
        .slice()
        .sort((left, right) => left.sequence - right.sequence)
        .map((point) => [point.latitude, point.longitude] as LatLngTuple),
    [scenario.trackPoints],
  );

  const smoothTrack = useMemo(() => createSmoothPath(orderedTrackPoints), [orderedTrackPoints]);

  const latestPosition = orderedTrackPoints[orderedTrackPoints.length - 1] ?? null;
  const previousPosition = orderedTrackPoints[orderedTrackPoints.length - 2] ?? null;
  const latestBearing =
    latestPosition && previousPosition ? bearingDegrees(previousPosition, latestPosition) : 0;

  /** Arrow sits just ahead of the latest point so it never hides the position dot. */
  const arrowPosition = useMemo<LatLngTuple | null>(() => {
    if (!latestPosition) return null;
    return [
      latestPosition[0] + Math.cos((latestBearing * Math.PI) / 180) * 0.14,
      latestPosition[1] + (Math.sin((latestBearing * Math.PI) / 180) * 0.14) / 0.94,
    ];
  }, [latestPosition, latestBearing]);

  const midChevrons = useMemo(
    () =>
      [0.42, 0.74]
        .map((ratio) => ({
          ratio,
          position: pathPointAtRatio(smoothTrack, ratio),
          bearing: pathBearingAtRatio(smoothTrack, ratio),
        }))
        .filter((chevron): chevron is { ratio: number; position: LatLngTuple; bearing: number } =>
          Boolean(chevron.position),
        ),
    [smoothTrack],
  );

  const initialBounds = useMemo(
    () => getInitialViewBounds(scenario, assets),
    [scenario, assets],
  );

  const toggleLayer = (layer: LayerKey): void => {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  };

  return (
    <div className="relative h-[560px] overflow-hidden rounded-2xl border border-white/10 bg-slate-950 lg:h-[650px]">
      {mapError ? (
        <div className="absolute inset-0 z-[500] grid place-items-center bg-slate-950/95 p-8 text-center">
          <div>
            <MapPinned className="mx-auto text-cyan-300" size={32} />
            <p className="mt-3 font-semibold text-slate-100">Map tiles are unavailable</p>
            <p className="mt-1 max-w-xs text-sm text-slate-400">
              The scenario layers remain available when a tile connection returns.
            </p>
            <button
              type="button"
              onClick={() => setMapError(false)}
              className="mt-4 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
            >
              Retry map
            </button>
          </div>
        </div>
      ) : null}
      <MapContainer
        center={ODPISHA_CENTER}
        zoom={7}
        scrollWheelZoom
        // fitBounds rounds *down* to a whole zoom level, so an integer snap
        // discards up to half the frame and left the initial view a zoom level
        // too far out. A quarter-step snap lets the fit land where the data
        // actually sits; wheel zoom stays smooth.
        zoomSnap={0.25}
        className="h-full w-full bg-slate-950"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          eventHandlers={{ tileerror: () => setMapError(true) }}
        />
        <FitScenario bounds={initialBounds} register={registerFit} />

        {layers.impactZones
          ? scenario.impactZones.map((zone) => {
              const color = riskCategoryColors[zone.severity];
              return (
                <Circle
                  key={zone.id}
                  center={[zone.coordinates.latitude, zone.coordinates.longitude]}
                  radius={zone.radiusKm * 1000}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: severityFillOpacity[zone.severity],
                    opacity: 0.8,
                    weight: 2,
                    dashArray: hazardDashPatterns[zone.hazard],
                  }}
                >
                  <Tooltip direction="top" opacity={1}>
                    <div className="space-y-0.5">
                      <p className="font-semibold">{zone.name}</p>
                      <p>{zone.severity} {zone.hazard} exposure · {zone.radiusKm} km radius</p>
                    </div>
                  </Tooltip>
                </Circle>
              );
            })
          : null}

        {layers.track ? (
          <>
            <Polyline positions={smoothTrack} pathOptions={TRACK_GLOW_OPTIONS} />
            <Polyline positions={smoothTrack} pathOptions={TRACK_CORE_OPTIONS} />
            {midChevrons.map((chevron) => (
              <Marker
                key={`chevron-${chevron.ratio}`}
                position={chevron.position}
                icon={createChevronIcon(chevron.bearing, { size: 13, color: "#a5f3fc", stroke: 2.5 })}
                interactive={false}
                keyboard={false}
              />
            ))}
            {scenario.trackPoints.map((point, index) => {
              const isLatest = index === scenario.trackPoints.length - 1;
              return (
                <CircleMarker
                  key={`${point.timestamp}-${point.sequence}`}
                  center={[point.latitude, point.longitude]}
                  radius={isLatest ? 8 : 5}
                  pathOptions={{
                    color: isLatest ? "#f8fafc" : "#67e8f9",
                    fillColor: isLatest ? "#fb7185" : "#0e7490",
                    fillOpacity: 1,
                    weight: 2,
                  }}
                >
                  <Tooltip direction="top" opacity={1}>
                    <div className="space-y-0.5">
                      <p className="font-semibold">
                        {isLatest ? "Latest modeled position" : `Modeled point ${index + 1}`}
                      </p>
                      <p>{point.windKph} km/h winds · {point.pressureHpa} hPa</p>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })}
            {latestPosition ? (
              <Marker
                position={latestPosition}
                icon={haloIcon}
                interactive={false}
                keyboard={false}
                alt="Latest modeled cyclone position"
              />
            ) : null}
            {arrowPosition ? (
              <Marker
                position={arrowPosition}
                icon={createChevronIcon(latestBearing, { size: 22, color: "#f8fafc", stroke: 4.5 })}
                interactive={false}
                keyboard={false}
                alt="Modeled movement direction"
              />
            ) : null}
          </>
        ) : null}

        {layers.assets
          ? assets.map((asset) => {
              const selected = asset.id === selectedAssetId;
              const category = criticalityRiskCategory[asset.criticality];
              const color = riskCategoryColors[category];
              return (
                <CircleMarker
                  key={asset.id}
                  center={[asset.location.latitude, asset.location.longitude]}
                  radius={selected ? 10 : 7}
                  pathOptions={{
                    color: selected ? "#f8fafc" : color,
                    fillColor: color,
                    fillOpacity: selected ? 1 : 0.9,
                    weight: selected ? 3 : 2,
                  }}
                  eventHandlers={{ click: () => onSelectAsset(asset) }}
                >
                  <Tooltip direction="top" opacity={1}>
                    <div className="space-y-0.5">
                      <p className="font-semibold">{asset.name}</p>
                      <p>{asset.type} · {asset.criticality} criticality · {riskCategoryLabels[category]} risk</p>
                    </div>
                  </Tooltip>
                </CircleMarker>
              );
            })
          : null}
      </MapContainer>

      <div className="pointer-events-none absolute left-4 right-4 top-4 z-[500] flex flex-wrap items-start justify-between gap-3">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/85 p-2 shadow-xl backdrop-blur">
          <div className="mb-2 flex items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <Layers3 size={13} aria-hidden="true" />
            Layers
          </div>
          <div className="flex flex-wrap gap-1.5">
            <LayerButton active={layers.track} label="Track" icon={Route} onClick={() => toggleLayer("track")} />
            <LayerButton active={layers.impactZones} label="Impact zones" icon={Waves} onClick={() => toggleLayer("impactZones")} />
            <LayerButton active={layers.assets} label="Assets" icon={Building2} onClick={() => toggleLayer("assets")} />
            <button
              type="button"
              onClick={() => fitScenarioRef.current()}
              disabled={!initialBounds}
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-xs font-semibold text-slate-400 transition hover:border-white/20 hover:text-slate-200 disabled:opacity-40"
            >
              <LocateFixed size={14} aria-hidden="true" />
              Fit scenario
            </button>
          </div>
        </div>
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-amber-100 backdrop-blur">
          <ShieldAlert size={13} aria-hidden="true" />
          Synthetic scenario
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-4 left-4 z-[500] rounded-2xl border border-white/10 bg-slate-950/85 p-3 text-[11px] text-slate-300 shadow-xl backdrop-blur">
        <div className="mb-2 flex items-center gap-2 font-semibold text-slate-100">
          <MapPinned size={14} className="text-cyan-300" aria-hidden="true" />
          Map legend
        </div>
        <div className="space-y-1.5">
          <span className="flex items-center gap-2">
            <i className="h-[3px] w-5 rounded-full bg-cyan-300" />
            Cyclone track, arrow marks direction
          </span>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {riskCategoryOrder.map((category) => (
              <span key={category} className="flex items-center gap-1.5">
                <i
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: riskCategoryColors[category] }}
                />
                {riskCategoryLabels[category]} risk
              </span>
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        aria-label="Close map notice"
        onClick={() => setMapError(false)}
        className={`absolute right-4 top-4 z-[501] rounded-lg bg-slate-950/80 p-1 text-slate-400 hover:text-slate-100 ${mapError ? "block" : "hidden"}`}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}
