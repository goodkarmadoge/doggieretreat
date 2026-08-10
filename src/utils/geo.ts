export interface Point {
  lat: number;
  lng: number;
}

const R_KM = 6371;

/** Haversine great-circle distance in km. */
export function distanceKm(a: Point, b: Point): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

export function pathLengthKm(points: Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += distanceKm(points[i], points[i + 1]);
  }
  return total;
}
