import { describe, expect, it } from "vitest";
import type { InfrastructureAsset, Scenario } from "@cycloneshield/shared";
import {
  bearingDegrees,
  createSmoothPath,
  getInitialViewBounds,
  getScenarioBounds,
  haversineKm,
  pathBearingAtRatio,
  pathPointAtRatio,
  TRACK_FOCUS_RADIUS_KM,
  type LatLngTuple,
} from "./geo.js";

const trackPoints = [
  { sequence: 0, timestamp: "t0", latitude: 12.8, longitude: 82.6, windKph: 65, pressureHpa: 998, movementKph: 14, movementDirectionDeg: 312 },
  { sequence: 1, timestamp: "t1", latitude: 14.1, longitude: 83.4, windKph: 85, pressureHpa: 990, movementKph: 16, movementDirectionDeg: 318 },
  { sequence: 2, timestamp: "t2", latitude: 15.5, longitude: 84.1, windKph: 110, pressureHpa: 972, movementKph: 18, movementDirectionDeg: 325 },
  { sequence: 3, timestamp: "t3", latitude: 16.9, longitude: 84.7, windKph: 140, pressureHpa: 954, movementKph: 20, movementDirectionDeg: 330 },
  { sequence: 4, timestamp: "t4", latitude: 18.2, longitude: 85.1, windKph: 165, pressureHpa: 942, movementKph: 22, movementDirectionDeg: 334 },
  { sequence: 5, timestamp: "t5", latitude: 19.7, longitude: 85.3, windKph: 175, pressureHpa: 936, movementKph: 24, movementDirectionDeg: 338 },
];

const impactZones = [
  { id: "z1", name: "Access", hazard: "access", severity: "high", coordinates: { latitude: 21.1, longitude: 86.9 }, radiusKm: 90, description: "d" },
  { id: "z2", name: "Rainfall", hazard: "rainfall", severity: "high", coordinates: { latitude: 19.9, longitude: 82.8 }, radiusKm: 130, description: "d" },
  { id: "z3", name: "Wind", hazard: "wind", severity: "critical", coordinates: { latitude: 20.3, longitude: 85.6 }, radiusKm: 110, description: "d" },
  { id: "z4", name: "Surge", hazard: "surge", severity: "critical", coordinates: { latitude: 19.8, longitude: 85.8 }, radiusKm: 95, description: "d" },
] as const;

const assets = [
  { id: "a1", name: "Balasore", type: "power", district: "Balasore", location: { latitude: 21.493, longitude: 86.933 }, capacity: null, populationServed: null, criticality: "critical", vulnerabilityScore: 0.7, notes: "n" },
  { id: "a2", name: "Ganjam", type: "water", district: "Ganjam", location: { latitude: 19.248, longitude: 85.118 }, capacity: null, populationServed: null, criticality: "high", vulnerabilityScore: 0.5, notes: "n" },
] as unknown as InfrastructureAsset[];

const scenario = {
  id: "s1",
  slug: "nila-odisha-2026",
  name: "Nila",
  summary: "s",
  provenance: "p",
  isSynthetic: true,
  validFrom: "v",
  validTo: "v",
  landfallAt: null,
  trackPoints,
  impactZones: impactZones as unknown as Scenario["impactZones"],
} as unknown as Scenario;

describe("scenario bounds", () => {
  it("covers every track point, zone extent and asset coordinate", () => {
    const bounds = getScenarioBounds(scenario, assets);
    expect(bounds).not.toBeNull();
    expect(bounds?.minLatitude).toBeLessThanOrEqual(12.8);
    expect(bounds?.maxLatitude).toBeGreaterThan(21.1);
    expect(bounds?.minLongitude).toBeLessThan(82.6);
    expect(bounds?.maxLongitude).toBeGreaterThan(86.933);
  });

  it("includes the full radius of every impact zone", () => {
    const bounds = getScenarioBounds(scenario, assets);
    // Widest zone is 130 km radius near 19.9 N, which must push the box west of the track.
    expect(bounds?.minLongitude).toBeLessThan(82.8 - 1.0);
  });

  it("returns null when there is nothing to fit", () => {
    const empty = { ...scenario, trackPoints: [], impactZones: [] } as unknown as Scenario;
    expect(getScenarioBounds(empty, [])).toBeNull();
  });
});

describe("initial view bounds", () => {
  const bounds = getInitialViewBounds(scenario, assets);

  it("drops the far open-ocean approach tail so the cluster can fill the map", () => {
    expect(bounds?.minLatitude).toBeGreaterThan(12.8);
  });

  it("still frames the near-field approach, the zones and every asset", () => {
    expect(bounds?.minLatitude).toBeLessThanOrEqual(18.2);
    expect(bounds?.maxLatitude).toBeGreaterThan(21.1);
    expect(bounds?.minLongitude).toBeLessThanOrEqual(82.8);
    expect(bounds?.maxLongitude).toBeGreaterThanOrEqual(86.933);
  });

  it("keeps the latest track position inside the frame", () => {
    expect(bounds?.maxLatitude).toBeGreaterThanOrEqual(19.7);
    expect(bounds?.maxLongitude).toBeGreaterThanOrEqual(85.3);
  });

  it("spans far less of the subcontinent than the full track", () => {
    const full = getScenarioBounds(scenario, assets);
    const fullSpan = (full?.maxLatitude ?? 0) - (full?.minLatitude ?? 0);
    const focusSpan = (bounds?.maxLatitude ?? 0) - (bounds?.minLatitude ?? 0);
    expect(focusSpan).toBeLessThan(fullSpan * 0.75);
  });

  it("keeps a compact scenario framed by the whole track", () => {
    const compact = {
      ...scenario,
      trackPoints: trackPoints.slice(4),
    } as unknown as Scenario;
    const compactBounds = getInitialViewBounds(compact, assets);
    expect(compactBounds?.minLatitude).toBeLessThanOrEqual(18.2);
  });

  it("stays tight enough to frame the coast instead of zooming out to a region", () => {
    // Zone radii previously inflated the north-south span to ~4.1 degrees, which
    // forced zoom 7 and exposed >1000km of empty land and ocean either side of
    // Odisha. The cluster itself only spans ~3.3 degrees north-south.
    const span = (bounds?.maxLatitude ?? 0) - (bounds?.minLatitude ?? 0);
    expect(span).toBeLessThan(3.4);
  });

  it("does not let zone radii widen the frame beyond the cluster", () => {
    // Balasore sits at 21.1N with a radius that would reach ~22.3N.
    expect(bounds?.maxLatitude).toBeLessThan(21.5);
    // Kalahandi sits at 82.8E with a radius that would reach ~81.5E.
    expect(bounds?.minLongitude).toBeGreaterThan(82.7);
  });
});

describe("distance and bearing", () => {
  it("measures great-circle distance", () => {
    const [kilometres] = [haversineKm([20, 85], [21, 85])];
    expect(kilometres).toBeGreaterThan(110);
    expect(kilometres).toBeLessThan(112);
  });

  it("reports compass bearings clockwise from north", () => {
    // Due north and due south are exact; travelling along a parallel is a great
    // circle whose initial bearing is a little off 90/270.
    expect(bearingDegrees([20, 85], [21, 85])).toBeCloseTo(0, 1);
    expect(bearingDegrees([20, 85], [19, 85])).toBeCloseTo(180, 1);
    expect(bearingDegrees([20, 85], [20, 86])).toBeCloseTo(90, 0);
    expect(bearingDegrees([20, 85], [20, 84])).toBeCloseTo(270, 0);
  });
});

describe("smooth track path", () => {
  const points: LatLngTuple[] = [
    [12.8, 82.6],
    [15.5, 84.1],
    [18.2, 85.1],
    [19.7, 85.3],
  ];
  const path = createSmoothPath(points);

  it("keeps the first and last vertices", () => {
    expect(path[0]).toEqual(points[0]);
    expect(path[path.length - 1]).toEqual(points[points.length - 1]);
  });

  it("adds intermediate samples so the line reads as a curve", () => {
    expect(path.length).toBeGreaterThan(points.length * 4);
  });

  it("stays inside the bounding box of the control points", () => {
    const latitudes = points.map(([lat]) => lat);
    const longitudes = points.map(([, lon]) => lon);
    for (const [lat, lon] of path) {
      expect(lat).toBeGreaterThanOrEqual(Math.min(...latitudes) - 0.001);
      expect(lat).toBeLessThanOrEqual(Math.max(...latitudes) + 0.001);
      expect(lon).toBeGreaterThanOrEqual(Math.min(...longitudes) - 0.001);
      expect(lon).toBeLessThanOrEqual(Math.max(...longitudes) + 0.001);
    }
  });

  it("returns the input for degenerate paths", () => {
    expect(createSmoothPath([])).toEqual([]);
    expect(createSmoothPath([[1, 2]])).toEqual([[1, 2]]);
  });

  it("samples positions and tangent bearings along the curve", () => {
    const mid = pathPointAtRatio(path, 0.5);
    expect(mid).not.toBeNull();
    const bearing = pathBearingAtRatio(path, 0.5);
    // The seeded track runs north-north-east, so the tangent points north-east.
    expect(bearing).toBeGreaterThan(0);
    expect(bearing).toBeLessThan(90);
  });
});

describe("track focus radius", () => {
  it("keeps the focus radius inside the documented range", () => {
    expect(TRACK_FOCUS_RADIUS_KM).toBeGreaterThan(200);
    expect(TRACK_FOCUS_RADIUS_KM).toBeLessThan(900);
  });
});
