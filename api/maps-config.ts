import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  BROWSER_KEY_NAMES,
  KEY_NAMES,
  getBrowserApiKey,
  getMapId,
} from "./_lib/google.js";

/**
 * GET /api/maps-config
 *
 * Hands the browser the Maps JavaScript API key so the Transportation map can
 * render. This endpoint deliberately serves a credential, which deserves an
 * explanation rather than a raised eyebrow:
 *
 * The Maps JS API authenticates from the page. There is no server-side variant
 * to proxy, so its key is public no matter how it is delivered — bundling it at
 * build time would expose it just as completely. Serving it at runtime instead
 * buys three concrete things:
 *
 *   1. The key never enters the git history or the built bundle.
 *   2. It can be rotated in Vercel without a rebuild.
 *   3. When it is absent the app can say so precisely, instead of rendering a
 *      grey rectangle with a console error nobody reads.
 *
 * What actually protects this key is the HTTP referrer restriction set on it in
 * the Google Cloud console, not its delivery mechanism.
 *
 * When no dedicated browser key exists this falls back to the server key, which
 * is a deliberate trade with real cost — see getBrowserApiKey in _lib/google.ts
 * for what it gives up and how to bound it.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }

  const resolved = getBrowserApiKey();

  if (!resolved) {
    // Names only, never values — the same diagnostic contract as route-matrix.
    const present = Object.keys(process.env)
      .filter((n) => /google|maps/i.test(n))
      .sort();

    res.status(200).json({
      configured: false,
      reason: "no_maps_key",
      message:
        "No Maps API key found at all — neither a dedicated browser key nor the server key used for geocoding. Add one to the Vercel project, then redeploy: env vars only apply to deployments created after they are added.",
      searchedNames: [...BROWSER_KEY_NAMES, ...KEY_NAMES],
      mapsLikeNamesPresent: present,
    });
    return;
  }

  // A public key still should not sit in a shared CDN cache indefinitely, so
  // this is cached briefly in the browser only, keeping rotation quick.
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json({
    configured: true,
    key: resolved.key,
    mapId: getMapId(),
    // True when this is the server key doing double duty. Surfaced so the
    // condition is observable rather than buried in an env var nobody reads.
    sharedWithServerKey: resolved.shared,
  });
}
