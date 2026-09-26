import type {
  BoundingBox,
  ImpactZone,
  InfrastructureAsset,
  Scenario,
  TrackPoint,
} from "@cycloneshield/shared";

export type LatLngTuple = [latitude: number, longitude: number];

const KILOMETRES_PER_LATITUDE_DEGREE = 111.32;
const EARTH_RADIUS_KM = 6371;

/**
 * The seeded Odisha approach starts roughly 950 km south-west of the exposure
 * cluster, out in open ocean. Framing every track point verbatim leaves the
 * Bhubaneswar/Puri cluster at about a quarter of the viewport, which is the
 * subcontinent-wide view this fit is meant to remove. The initial view
 * therefore frames the exposure cluster (every asset plus the full extent of
 * every impact zone) together with the modelled approach within this radius,
 * and always keeps the latest track position on screen. The whole track is
 * still drawn and reachable by pan or zoom.
 *
 * 280 km keeps the last two or three track points - the approach into the
 * impact area - while leaving the fit comfortably inside the largest integer
 * zoom that still shows every zone circle and asset, so the framing does not
 * collapse on a slightly different viewport.
 */
export const TRACK_FOCUS_RADIUS_KM = 280;

export function kilometresToLatitudeDegrees(kilometres: number): number {
  return kilometres / KILOMETRES_PER_LATITUDE_DEGREE;
}

export function kilometresToLongitudeDegrees(kilometres: number, atLatitude: number): number {
  const cosine = Math.max(Math.cos((atLatitude * Math.PI) / 180), 0.01);
  return kilometres / (KILOMETRES_PER_LATITUDE_DEGREE * cosine);
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function haversineKm(from: LatLngTuple, to: LatLngTuple): number {
  const deltaLat = toRadians(to[0] - from[0]);
  const deltaLon = toRadians(to[1] - from[1]);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(toRadians(from[0])) * Math.cos(toRadians(to[0])) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function normaliseBearing(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/** Clockwise bearing in degrees from north, matching track `movementDirectionDeg`. */
export function bearingDegrees(from: LatLngTuple, to: LatLngTuple): number {
  const fromLat = toRadians(from[0]);
  const toLat = toRadians(to[0]);
  const deltaLon = toRadians(to[1] - from[1]);
  const y = Math.sin(deltaLon) * Math.cos(toLat);
  const x =
    Math.cos(fromLat) * Math.sin(toLat) - Math.sin(fromLat) * Math.cos(toLat) * Math.cos(deltaLon);
  return normaliseBearing((Math.atan2(y, x) * 180) / Math.PI);
}

function pointBounds(point: LatLngTuple): BoundingBox {
  return {
    minLatitude: point[0],
    maxLatitude: point[0],
    minLongitude: point[1],
    maxLongitude: point[1],
  };
}

function zoneBounds(zone: ImpactZone): BoundingBox {
  const { latitude, longitude } = zone.coordinates;
  const latitudeRadius = kilometresToLatitudeDegrees(zone.radiusKm);
  const longitudeRadius = kilometresToLongitudeDegrees(zone.radiusKm, latitude);
  return {
    minLatitude: latitude - latitudeRadius,
    maxLatitude: latitude + latitudeRadius,
    minLongitude: longitude - longitudeRadius,
    maxLongitude: longitude + longitudeRadius,
  };
}

function unionBounds(current: BoundingBox | null, next: BoundingBox): BoundingBox {
  if (!current) return next;
  return {
    minLatitude: Math.min(current.minLatitude, next.minLatitude),
    maxLatitude: Math.max(current.maxLatitude, next.maxLatitude),
    minLongitude: Math.min(current.minLongitude, next.minLongitude),
    maxLongitude: Math.max(current.maxLongitude, next.maxLongitude),
  };
}

export function boundsCorners(bounds: BoundingBox): [LatLngTuple, LatLngTuple] {
  return [
    [bounds.minLatitude, bounds.minLongitude],
    [bounds.maxLatitude, bounds.maxLongitude],
  ];
}

export function getExposureCentroid(scenario: Scenario, assets: InfrastructureAsset[]): LatLngTuple {
  const latitudes: number[] = [];
  const longitudes: number[] = [];

  for (const asset of assets) {
    latitudes.push(asset.location.latitude);
    longitudes.push(asset.location.longitude);
  }
  for (const zone of scenario.impactZones) {
    latitudes.push(zone.coordinates.latitude);
    longitudes.push(zone.coordinates.longitude);
  }
  if (latitudes.length === 0) {
    for (const point of scenario.trackPoints) {
      latitudes.push(point.latitude);
      longitudes.push(point.longitude);
    }
  }
  if (latitudes.length === 0) return [0, 0];

  return [
    latitudes.reduce((total, value) => total + value, 0) / latitudes.length,
    longitudes.reduce((total, value) => total + value, 0) / longitudes.length,
  ];
}

/** Full extent of every track point, impact zone and asset coordinate. */
export function getScenarioBounds(
  scenario: Scenario,
  assets: InfrastructureAsset[],
): BoundingBox | null {
  let bounds: BoundingBox | null = null;
  for (const point of scenario.trackPoints) {
    bounds = unionBounds(bounds, pointBounds([point.latitude, point.longitude]));
  }
  for (const zone of scenario.impactZones) {
    bounds = unionBounds(bounds, zoneBounds(zone));
  }
  for (const asset of assets) {
    bounds = unionBounds(bounds, pointBounds([asset.location.latitude, asset.location.longitude]));
  }
  return bounds;
}

export function getTrackFocusPoints(
  scenario: Scenario,
  assets: InfrastructureAsset[],
): TrackPoint[] {
  const centroid = getExposureCentroid(scenario, assets);
  const focused = scenario.trackPoints.filter(
    (point) => haversineKm(centroid, [point.latitude, point.longitude]) <= TRACK_FOCUS_RADIUS_KM,
  );
  const latest = scenario.trackPoints[scenario.trackPoints.length - 1];
  if (latest && !focused.some((point) => point.sequence === latest.sequence)) {
    return [...focused, latest];
  }
  return focused;
}

/**
 * Bounding box used for the initial camera position: the exposure cluster
 * (assets and full impact-zone extents) plus the near-field approach and the
 * latest track position.
 */
export function getInitialViewBounds(
  scenario: Scenario,
  assets: InfrastructureAsset[],
): BoundingBox | null {
  const focusPoints = getTrackFocusPoints(scenario, assets);
  let bounds: BoundingBox | null = null;
  for (const point of focusPoints) {
    bounds = unionBounds(bounds, pointBounds([point.latitude, point.longitude]));
  }
  for (const zone of scenario.impactZones) {
    bounds = unionBounds(bounds, zoneBounds(zone));
  }
  for (const asset of assets) {
    bounds = unionBounds(bounds, pointBounds([asset.location.latitude, asset.location.longitude]));
  }
  return bounds;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/** Catmull-Rom spline sampled into a polyline, so the track reads as a curve. */
export function createSmoothPath(
  points: LatLngTuple[],
  subdivisions = 16,
): LatLngTuple[] {
  if (points.length < 2) return points.slice();
  const sampled: LatLngTuple[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[Math.max(0, index - 1)];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[Math.min(points.length - 1, index + 2)];
    for (let step = 0; step < subdivisions; step += 1) {
      const t = step / subdivisions;
      sampled.push([catmullRom(p0[0], p1[0], p2[0], p3[0], t), catmullRom(p0[1], p1[1], p2[1], p3[1], t)]);
    }
  }
  sampled.push(points[points.length - 1]);
  return sampled;
}

const TANGENT_WINDOW = 3;

export function pathPointAtRatio(path: LatLngTuple[], ratio: number): LatLngTuple | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0];
  const position = Math.min(Math.max(ratio, 0), 1) * (path.length - 1);
  const index = Math.floor(position);
  const nextIndex = Math.min(index + 1, path.length - 1);
  const t = position - index;
  return [
    path[index][0] + (path[nextIndex][0] - path[index][0]) * t,
    path[index][1] + (path[nextIndex][1] - path[index][1]) * t,
  ];
}

export function pathBearingAtRatio(path: LatLngTuple[], ratio: number): number {
  if (path.length < 2) return 0;
  const position = Math.min(Math.max(ratio, 0), 1) * (path.length - 1);
  const index = Math.min(Math.max(Math.round(position), 0), path.length - 1);
  const from = path[Math.max(0, index - TANGENT_WINDOW)];
  const to = path[Math.min(path.length - 1, index + TANGENT_WINDOW)];
  return bearingDegrees(from, to);
}
