import { distanceKm, type Point } from "@/utils/geo";

/**
 * Travel-cost lookup used by the route builder.
 *
 * Two sources:
 *   - "google"    — real road distance and traffic-aware drive time
 *   - "haversine" — straight-line fallback, used when the key is not
 *                   configured, the request fails, or the run is too large
 *
 * The fallback matters: this prototype must stay fully usable with no API key
 * and no network, which is how the demo dataset is explored.
 */
export type TravelSource = "google" | "haversine";

export interface Leg {
  km: number;
  seconds: number;
}

export interface TravelMatrix {
  source: TravelSource;
  leg(a: Point, b: Point): Leg;
  /** Set when the Google path was attempted and did not succeed. */
  note?: string;
}

const keyOf = (p: Point) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const pairKey = (a: Point, b: Point) => `${keyOf(a)}|${keyOf(b)}`;

/** Rough Singapore urban average, only used by the fallback. */
const FALLBACK_KMH = 28;

export function haversineMatrix(note?: string): TravelMatrix {
  return {
    source: "haversine",
    note,
    leg(a, b) {
      const km = distanceKm(a, b);
      return { km, seconds: (km / FALLBACK_KMH) * 3600 };
    },
  };
}

interface MatrixCell {
  originIndex: number;
  destinationIndex: number;
  meters: number;
  seconds: number;
  ok: boolean;
}

/**
 * Cache keyed by the exact point set plus a 15-minute time bucket. Traffic
 * does not change meaningfully inside 15 minutes, and the matrix is billed
 * per element, so re-requesting on every render would be wasteful.
 */
const cache = new Map<string, TravelMatrix>();
const inflight = new Map<string, Promise<TravelMatrix>>();

function cacheKey(points: Point[], bucket: string): string {
  return `${bucket}::${points.map(keyOf).join(";")}`;
}

function timeBucket(now = Date.now()): string {
  return String(Math.floor(now / (15 * 60 * 1000)));
}

export async function fetchTravelMatrix(
  points: Point[],
  departureTimeISO?: string
): Promise<TravelMatrix> {
  if (points.length < 2) return haversineMatrix();

  const key = cacheKey(points, departureTimeISO ?? timeBucket());
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = inflight.get(key);
  if (pending) return pending;

  const request = (async (): Promise<TravelMatrix> => {
    try {
      const res = await fetch("/api/route-matrix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          points: points.map((p) => ({ lat: p.lat, lng: p.lng })),
          departureTime: departureTimeISO,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        return haversineMatrix(
          res.status === 503
            ? "Google routing is not configured on the server, so distances are straight-line estimates."
            : body.message ?? `Routing request failed (${res.status}).`
        );
      }

      const { cells } = (await res.json()) as { cells: MatrixCell[] };
      const table = new Map<string, Leg>();

      // Cells arrive in arbitrary order — index by the pair, not by position.
      for (const c of cells) {
        const from = points[c.originIndex];
        const to = points[c.destinationIndex];
        if (!from || !to || !c.ok) continue;
        table.set(pairKey(from, to), { km: c.meters / 1000, seconds: c.seconds });
      }

      if (!table.size) {
        return haversineMatrix("Google returned no usable routes; using straight-line estimates.");
      }

      const fallback = haversineMatrix();
      const matrix: TravelMatrix = {
        source: "google",
        leg(a, b) {
          return table.get(pairKey(a, b)) ?? fallback.leg(a, b);
        },
      };
      cache.set(key, matrix);
      return matrix;
    } catch {
      return haversineMatrix("Could not reach the routing service; using straight-line estimates.");
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, request);
  return request;
}

export interface GeocodeResponseItem {
  address: string;
  lat: number | null;
  lng: number | null;
  formatted?: string;
  locationType?: string;
  status: string;
}

export async function geocode(addresses: string[]): Promise<GeocodeResponseItem[]> {
  if (!addresses.length) return [];
  const res = await fetch("/api/geocode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Geocoding failed (${res.status}).`);
  }
  const { results } = (await res.json()) as { results: GeocodeResponseItem[] };
  return results;
}
