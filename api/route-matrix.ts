import type { VercelRequest, VercelResponse } from "@vercel/node";
// Explicit .js extension: Vercel emits ESM, and an extensionless relative
// import fails to resolve at runtime. Shared code lives under api/_lib so
// Vercel compiles it alongside the handlers without routing it.
import {
  MAX_MATRIX_ELEMENTS,
  computeRouteMatrix,
  getApiKey,
  type LatLng,
} from "./_lib/google.js";

/**
 * POST /api/route-matrix
 *   { points: {lat,lng}[], departureTime?: ISO string }
 *
 * Returns the full square matrix between every supplied point, which is what
 * the route builder needs: the depot is simply points[0].
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const key = getApiKey();
  if (!key) {
    res.status(503).json({
      error: "not_configured",
      message:
        "GOOGLE_MAPS_API_KEY is not set on the server. Add it in the Vercel project's Environment Variables.",
    });
    return;
  }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};
  const points = (body as { points?: unknown }).points;
  const departureTime = (body as { departureTime?: unknown }).departureTime;

  if (
    !Array.isArray(points) ||
    points.some(
      (p) =>
        !p ||
        typeof (p as LatLng).lat !== "number" ||
        typeof (p as LatLng).lng !== "number"
    )
  ) {
    res.status(400).json({ error: "points must be an array of {lat, lng}." });
    return;
  }

  const n = points.length;
  if (n < 2) {
    res.status(200).json({ n, cells: [] });
    return;
  }
  if (n * n > MAX_MATRIX_ELEMENTS) {
    res.status(400).json({
      error: "too_many_points",
      message: `${n} points is ${n * n} elements, over the ${MAX_MATRIX_ELEMENTS} traffic-aware limit. Split the run across more vans.`,
    });
    return;
  }

  try {
    const cells = await computeRouteMatrix(
      key,
      points as LatLng[],
      points as LatLng[],
      typeof departureTime === "string" ? departureTime : undefined
    );
    res.status(200).json({ n, cells });
  } catch (e) {
    res.status(502).json({ error: "upstream_failed", message: String(e) });
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
