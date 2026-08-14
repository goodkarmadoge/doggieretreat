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

/**
 * Env var names accepted for the Maps key, in priority order. The canonical
 * name is GOOGLE_MAPS_API_KEY; the rest are variants people actually type into
 * a dashboard, accepted so a naming slip is not a silent outage.
 */
export const KEY_NAMES = [
  "GOOGLE_MAPS_API_KEY",
  "MAPS_API_KEY",
  "GOOGLE_MAPS_KEY",
  "GOOGLE_API_KEY",
] as const;

export function getApiKey(): string | null {
  for (const name of KEY_NAMES) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }

  // Last resort: match case-insensitively. Vercel preserves the casing you
  // type, so "Maps_API_Key" is a different key from "MAPS_API_KEY".
  const wanted = new Set<string>(KEY_NAMES.map((n) => n.toLowerCase()));
  for (const [name, value] of Object.entries(process.env)) {
    if (wanted.has(name.toLowerCase()) && value?.trim()) return value.trim();
  }
  return null;
}

/**
 * Diagnostic for "I added the key but it still says not configured".
 * Returns env var NAMES only — never values. Names are not secrets; values are.
 */
export function keyDiagnostics(): {
  searched: string[];
  mapsLikeNamesPresent: string[];
} {
  const mapsLike = Object.keys(process.env).filter((n) =>
    /google|maps/i.test(n)
  );
  return { searched: [...KEY_NAMES], mapsLikeNamesPresent: mapsLike.sort() };
}

/* ------------------------------------------------------------------ */
/* Browser key                                                         */
/* ------------------------------------------------------------------ */

/**
 * The Maps JavaScript API runs in the page and authenticates from the browser,
 * so unlike Geocoding and Routes it cannot be proxied — its key is necessarily
 * public to anyone who opens devtools. Google's answer to that is restriction,
 * not secrecy: an HTTP-referrer-restricted key limited to the Maps JavaScript
 * API is only usable from your own domains.
 *
 * That makes it a categorically different credential from the one above, which
 * is why it gets its own env var. Never serve KEY_NAMES to the browser: those
 * keys can call Geocoding and Routes, both billed per request, and publishing
 * one hands out a live invoice.
 */
export const BROWSER_KEY_NAMES = [
  "GOOGLE_MAPS_BROWSER_KEY",
  "GOOGLE_MAPS_PUBLIC_KEY",
  "PUBLIC_GOOGLE_MAPS_API_KEY",
  "VITE_GOOGLE_MAPS_API_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY",
] as const;

/**
 * Map ID for the Maps JS vector renderer. Advanced Markers require one.
 * Google's DEMO_MAP_ID works without any Cloud console setup and is the
 * documented stand-in, so the map renders before anyone configures styling.
 */
export const MAP_ID_NAMES = ["GOOGLE_MAPS_MAP_ID", "MAPS_MAP_ID"] as const;

export const DEMO_MAP_ID = "DEMO_MAP_ID";

function firstEnv(names: readonly string[]): string | null {
  for (const name of names) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  // Same case-insensitive rescue as getApiKey — Vercel keeps the casing typed.
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [name, value] of Object.entries(process.env)) {
    if (wanted.has(name.toLowerCase()) && value?.trim()) return value.trim();
  }
  return null;
}

/**
 * Resolves the key the browser will use for the Maps JavaScript API.
 *
 * A dedicated browser key is preferred and checked first. Failing that, this
 * falls back to the server key — a deliberate operator decision, not an
 * oversight, taken so the map works without provisioning a second credential.
 *
 * What that trades away, recorded here so it is not rediscovered the hard way:
 * the returned key is served to every visitor and is therefore public. The
 * server key can call Geocoding and Routes, both billed per request, so anyone
 * reading it can spend against this account.
 *
 * It cannot be locked down with an HTTP referrer restriction either. Referrer
 * checks only apply to browser traffic, and the Vercel functions in this
 * directory send no referrer — adding one would break /api/geocode and
 * /api/route-matrix. The containing control is a quota cap and a billing alert
 * in the Google Cloud console, which bounds the exposure rather than removing
 * it. Provisioning GOOGLE_MAPS_BROWSER_KEY removes it.
 */
export function getBrowserApiKey(): { key: string; shared: boolean } | null {
  const dedicated = firstEnv(BROWSER_KEY_NAMES);
  if (dedicated) return { key: dedicated, shared: false };

  const server = getApiKey();
  return server ? { key: server, shared: true } : null;
}

export function getMapId(): string {
  return firstEnv(MAP_ID_NAMES) ?? DEMO_MAP_ID;
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
