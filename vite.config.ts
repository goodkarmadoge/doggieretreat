import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { computeRouteMatrix, geocodeAddresses, type LatLng } from "./api/_lib/google";

/**
 * `vite dev` does not run Vercel functions, so /api/* would only exist after
 * deploy. This mounts the same server logic on the dev server, which means
 * routing can be tested locally instead of by pushing and hoping.
 *
 * Dev only — production uses the real functions in /api.
 */
function devApiRoutes(apiKey: string | undefined): Plugin {
  return {
    name: "doggie-retreat-dev-api",
    apply: "serve",
    configureServer(server) {
      const readJson = (req: import("node:http").IncomingMessage) =>
        new Promise<Record<string, unknown>>((resolve) => {
          let raw = "";
          req.on("data", (c) => (raw += c));
          req.on("end", () => {
            try {
              resolve(JSON.parse(raw || "{}"));
            } catch {
              resolve({});
            }
          });
        });

      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0];
        if (url !== "/api/geocode" && url !== "/api/route-matrix") return next();

        res.setHeader("Content-Type", "application/json");

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: "Use POST." }));
          return;
        }
        if (!apiKey) {
          res.statusCode = 503;
          res.end(
            JSON.stringify({
              error: "not_configured",
              message:
                "GOOGLE_MAPS_API_KEY is not set. Add it to .env.local for local development.",
            })
          );
          return;
        }

        const body = await readJson(req);

        try {
          if (url === "/api/geocode") {
            const addresses = (body.addresses as string[]) ?? [];
            const results = await geocodeAddresses(apiKey, addresses);
            res.statusCode = 200;
            res.end(JSON.stringify({ results }));
            return;
          }

          const points = (body.points as LatLng[]) ?? [];
          if (points.length < 2) {
            res.statusCode = 200;
            res.end(JSON.stringify({ n: points.length, cells: [] }));
            return;
          }
          const cells = await computeRouteMatrix(
            apiKey,
            points,
            points,
            typeof body.departureTime === "string" ? body.departureTime : undefined
          );
          res.statusCode = 200;
          res.end(JSON.stringify({ n: points.length, cells }));
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: "upstream_failed", message: String(e) }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Third arg "" loads every var, not just VITE_-prefixed ones. The key stays
  // in the dev server process and is never injected into the client bundle.
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), devApiRoutes(env.GOOGLE_MAPS_API_KEY)],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: { port: 5173 },
  };
});
