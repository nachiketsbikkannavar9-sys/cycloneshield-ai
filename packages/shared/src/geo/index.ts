export type Coordinate = {
  latitude: number;
  longitude: number;
};

export function haversineDistanceKm(
  origin: Coordinate,
  destination: Coordinate,
): number {
  const earthRadiusKm = 6371;
  const toRadians = (value: number): number => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(destination.latitude - origin.latitude);
  const longitudeDelta = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.sin(longitudeDelta / 2) ** 2 *
      Math.cos(originLatitude) *
      Math.cos(destinationLatitude);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function pointInPolygon(
  point: Coordinate,
  polygon: Coordinate[],
): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index];
    const previous = polygon[(index + polygon.length - 1) % polygon.length];
    if (!current || !previous) continue;

    const intersects =
      current.longitude > point.longitude !== previous.longitude > point.longitude &&
      point.latitude <
        ((previous.latitude - current.latitude) *
          (point.longitude - current.longitude)) /
          (previous.longitude - current.longitude) +
          current.latitude;

    if (intersects) inside = !inside;
  }

  return inside;
}

export function normalizeCoordinateList(
  points: Coordinate[],
): Coordinate[] {
  return points.map(({ latitude, longitude }) => ({
    latitude: Number(latitude.toFixed(5)),
    longitude: Number(longitude.toFixed(5)),
  }));
}
