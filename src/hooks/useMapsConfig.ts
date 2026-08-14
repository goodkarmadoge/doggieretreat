import { useEffect, useState } from "react";

/**
 * Fetches the browser Maps JS key from /api/maps-config.
 *
 * The key is not bundled at build time, so it has to be fetched before the map
 * can mount. That request is made once per page load and shared: every screen
 * showing a map would otherwise refetch the same value.
 */

export interface MapsConfig {
  configured: boolean;
  key?: string;
  mapId?: string;
  /** Operator-facing explanation when the key is missing. */
  message?: string;
}

/** In-flight or settled request, shared across all callers. */
let pending: Promise<MapsConfig> | null = null;

function fetchConfig(): Promise<MapsConfig> {
  pending ??= fetch("/api/maps-config")
    .then((r) => (r.ok ? r.json() : { configured: false }))
    .then((j: MapsConfig) => j)
    .catch(() => ({
      configured: false,
      message: "Could not reach /api/maps-config.",
    }));
  return pending;
}

export function useMapsConfig(): MapsConfig | null {
  // null means "still asking" — distinct from a resolved "not configured",
  // so the map area can stay quiet instead of flashing an error on load.
  const [config, setConfig] = useState<MapsConfig | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchConfig().then((c) => {
      if (alive) setConfig(c);
    });
    return () => {
      alive = false;
    };
  }, []);

  return config;
}
