import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  BROWSER_KEY_NAMES,
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
 * The server-side key used by /api/geocode and /api/route-matrix is never
 * returned here — see BROWSER_KEY_NAMES in _lib/google.ts.
 */
export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Use GET." });
    return;
  }

  const key = getBrowserApiKey();

  if (!key) {
    // Names only, never values — the same diagnostic contract as route-matrix.
    const present = Object.keys(process.env)
      .filter((n) => /google|maps/i.test(n))
      .sort();

    res.status(200).json({
      configured: false,
      reason: "no_browser_key",
      message:
        "No browser Maps key found. Add a referrer-restricted Maps JavaScript API key to the Vercel project as GOOGLE_MAPS_BROWSER_KEY, then redeploy — env vars only apply to deployments created after they are added.",
      searchedNames: [...BROWSER_KEY_NAMES],
      mapsLikeNamesPresent: present,
    });
    return;
  }

  // A public key still should not sit in a shared CDN cache indefinitely, so
  // this is cached briefly in the browser only, keeping rotation quick.
  res.setHeader("Cache-Control", "private, max-age=300");
  res.status(200).json({ configured: true, key, mapId: getMapId() });
}
