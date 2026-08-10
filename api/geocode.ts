import type { VercelRequest, VercelResponse } from "@vercel/node";
import { geocodeAddresses, getApiKey } from "../src/server/google";

/**
 * POST /api/geocode  { addresses: string[] }
 *
 * Returns one result per address, in the order supplied. Failures come back
 * as a per-address status rather than failing the whole batch, so one bad
 * address cannot block an import.
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
  const addresses: unknown = (body as { addresses?: unknown }).addresses;

  if (!Array.isArray(addresses) || addresses.some((a) => typeof a !== "string")) {
    res.status(400).json({ error: "addresses must be an array of strings." });
    return;
  }
  if (addresses.length > 100) {
    res.status(400).json({ error: "Maximum 100 addresses per request." });
    return;
  }

  try {
    const results = await geocodeAddresses(key, addresses as string[]);
    res.status(200).json({ results });
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
