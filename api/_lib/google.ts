/**
 * Google Maps Platform calls. SERVER SIDE ONLY.
 *
 * The API key is read from process.env and never reaches the browser bundle.
 * A key shipped to the client is world-readable and billable by anyone who
 * views source, so every Google call is proxied through /api/*.
 *
 * APIs used, both authenticated with a Maps API key:
 *   - Geocoding API        — address -> lat/lng
 *   - Routes API           — computeRouteMatrix, traffic-aware drive times
 *
 * NOT used: Route Optimization API. That is the fleet VRP solver and it needs
 * OAuth2 service-account credentials, which an AIza... key cannot provide.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  address: string;
  lat: number | null;
  lng: number | null;
  formatted?: string;
  locationType?: string;
  status: string;
}

export interface MatrixCell {
  originIndex: number;
  destinationIndex: number;
  meters: number;
  seconds: number;
  ok: boolean;
}

export function getApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY?.trim() || null;
}

/* ------------------------------------------------------------------ */
/* Geocoding                                                           */
/* ------------------------------------------------------------------ */

export async function geocodeAddresses(
  key: string,
  addresses: string[]
): Promise<GeocodeResult[]> {
  const out: GeocodeResult[] = [];

  // Geocoding has no batch endpoint — one request per address, run with a
  // small concurrency cap so a 50-dog import does not open 50 sockets.
  const CONCURRENCY = 5;
  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const slice = addresses.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      slice.map(async (address): Promise<GeocodeResult> => {
        const url =
          "https://maps.googleapis.com/maps/api/geocode/json" +
          `?address=${encodeURIComponent(address)}` +
          "&components=country:SG" +
          `&key=${encodeURIComponent(key)}`;

        try {
          const res = await fetch(url);
          const json = (await res.json()) as {
            status: string;
            error_message?: string;
            results?: Array<{
              formatted_address: string;
              geometry: { location: LatLng; location_type?: string };
            }>;
          };

          const hit = json.results?.[0];
          if (json.status !== "OK" || !hit) {
            return { address, lat: null, lng: null, status: json.status || "ERROR" };
          }
          return {
            address,
            lat: hit.geometry.location.lat,
            lng: hit.geometry.location.lng,
            formatted: hit.formatted_address,
            locationType: hit.geometry.location_type,
            status: "OK",
          };
        } catch {
          return { address, lat: null, lng: null, status: "FETCH_FAILED" };
        }
      })
    );
    out.push(...settled);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Route matrix                                                        */
/* ------------------------------------------------------------------ */

/**
 * TRAFFIC_AWARE allows up to 625 elements per request. TRAFFIC_AWARE_OPTIMAL
 * is more accurate but caps at 100, which a 12-stop run already exceeds, so
 * TRAFFIC_AWARE is the right trade here.
 */
export const MAX_MATRIX_ELEMENTS = 625;

export async function computeRouteMatrix(
  key: string,
  origins: LatLng[],
  destinations: LatLng[],
  departureTimeISO?: string
): Promise<MatrixCell[]> {
  if (!origins.length || !destinations.length) return [];

  const elements = origins.length * destinations.length;
  if (elements > MAX_MATRIX_ELEMENTS) {
    throw new Error(
      `Matrix would be ${elements} elements, over the ${MAX_MATRIX_ELEMENTS} limit for traffic-aware requests.`
    );
  }

  const waypoint = (p: LatLng) => ({
    waypoint: { location: { latLng: { latitude: p.lat, longitude: p.lng } } },
  });

  const body: Record<string, unknown> = {
    origins: origins.map(waypoint),
    destinations: destinations.map(waypoint),
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_AWARE",
  };

  // departureTime must be in the future. Sending a past time is rejected, so
  // it is simply omitted and Google uses live conditions instead.
  if (departureTimeISO) {
    const t = Date.parse(departureTimeISO);
    if (Number.isFinite(t) && t > Date.now() + 60_000) {
      body.departureTime = new Date(t).toISOString();
    }
  }

  const res = await fetch(
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "originIndex,destinationIndex,duration,distanceMeters,status,condition",
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Routes API ${res.status}: ${text.slice(0, 300)}`);
  }

  const rows = (await res.json()) as Array<{
    originIndex: number;
    destinationIndex: number;
    distanceMeters?: number;
    duration?: string;
    condition?: string;
  }>;

  // Rows come back in arbitrary order — index by the pair, never by position.
  return rows.map((r) => ({
    originIndex: r.originIndex,
    destinationIndex: r.destinationIndex,
    meters: r.distanceMeters ?? 0,
    seconds: r.duration ? Number(String(r.duration).replace(/s$/, "")) || 0 : 0,
    ok: r.condition === "ROUTE_EXISTS",
  }));
}
