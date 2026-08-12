import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * POST /api/sync — cloud backup for the operations dataset.
 *
 * Supabase credentials stay on the server. Even though a publishable key is
 * designed to be public, this repo is public, so it is read from env rather
 * than committed, and the browser never sees it.
 *
 * The database schema (doggie_retreat) is NOT exposed to PostgREST. The only
 * reachable surface is two functions, dr_pull and dr_push, so a leaked key
 * cannot touch anything else in the project.
 */

const KEY_NAMES = ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_KEY"] as const;
const URL_NAMES = ["SUPABASE_URL", "SUPABASE_PROJECT_URL"] as const;

function pick(names: readonly string[]): string | null {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  for (const [name, value] of Object.entries(process.env)) {
    if (wanted.has(name.toLowerCase()) && value?.trim()) return value.trim();
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  const url = pick(URL_NAMES);
  const key = pick(KEY_NAMES);
  if (!url || !key) {
    res.status(503).json({
      error: "not_configured",
      message:
        "Cloud backup is not set up. Add SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in the Vercel project's Environment Variables, then redeploy.",
      searchedNames: [...URL_NAMES, ...KEY_NAMES],
      present: Object.keys(process.env).filter((n) => /supabase/i.test(n)).sort(),
    });
    return;
  }

  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};
  const op = String((body as { op?: unknown }).op ?? "");
  const workspaceId = String((body as { workspaceId?: unknown }).workspaceId ?? "");

  if (!workspaceId || workspaceId.length > 100) {
    res.status(400).json({ error: "workspaceId is required." });
    return;
  }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(args),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${fn} ${r.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  };

  try {
    if (op === "pull") {
      const data = await rpc("dr_pull", { p_workspace: workspaceId });
      res.status(200).json(data);
      return;
    }

    if (op === "push") {
      const payload = (body as { payload?: unknown }).payload ?? {};
      const baseRevision = (body as { baseRevision?: unknown }).baseRevision;
      const data = await rpc("dr_push", {
        p_workspace: workspaceId,
        p_label: String((body as { label?: unknown }).label ?? "Doggie Retreat"),
        p_device: String((body as { device?: unknown }).device ?? "unknown"),
        p_base_rev: typeof baseRevision === "number" ? baseRevision : null,
        p_payload: payload,
        p_force: (body as { force?: unknown }).force === true,
      });
      res.status(200).json(data);
      return;
    }

    res.status(400).json({ error: "op must be 'pull' or 'push'." });
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
