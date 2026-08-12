import { db } from "@/db/database";
import { recordAudit } from "@/db/repository";

/**
 * Data durability.
 *
 * Two independent seatbelts, on purpose:
 *  1. Local file export/import — works offline, needs no account, and is the
 *     one a staff member can actually use in a hurry.
 *  2. Cloud backup to Supabase — survives a cleared browser or a dead laptop,
 *     and lets a second device pick up the same dataset.
 *
 * Cloud is the nicer feature; local is the one that matters when something has
 * already gone wrong, which is why it does not depend on the network.
 */

export const SNAPSHOT_VERSION = 1;

export interface Snapshot {
  format: "doggie-retreat-snapshot";
  version: number;
  exportedAt: string;
  counts: Record<string, number>;
  tables: Record<string, unknown[]>;
  settings: unknown;
}

const TABLES = [
  "dogs", "attendance", "exceptions", "walkers", "floors", "audit",
  "reviewQueue", "vanOverrides", "transportOverrides",
  "walkLocks", "floorLocks", "routeLocks",
] as const;

type TableName = (typeof TABLES)[number];

const table = (name: TableName) => db.table(name);

export async function buildSnapshot(): Promise<Snapshot> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const name of TABLES) {
    const rows = await table(name).toArray();
    tables[name] = rows;
    counts[name] = rows.length;
  }
  const settings = await db.settings.get("singleton");
  return {
    format: "doggie-retreat-snapshot",
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    counts,
    tables,
    settings: settings ?? null,
  };
}

/** Download a snapshot as a file. No network, no account. */
export async function downloadSnapshot(): Promise<string> {
  const snap = await buildSnapshot();
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const name = `doggie-retreat-backup-${snap.exportedAt.slice(0, 10)}.json`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  await recordAudit({ action: `Exported a backup (${Object.values(snap.counts).reduce((a, b) => a + b, 0)} records)` });
  return name;
}

export interface RestoreReport {
  ok: boolean;
  error?: string;
  counts?: Record<string, number>;
}

/** Replace everything with a snapshot. Destructive by design and confirmed in the UI. */
export async function restoreSnapshot(text: string): Promise<RestoreReport> {
  let snap: Snapshot;
  try {
    snap = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON." };
  }
  if (snap?.format !== "doggie-retreat-snapshot") {
    return { ok: false, error: "That doesn't look like a Doggie Retreat backup." };
  }
  if (typeof snap.version !== "number" || snap.version > SNAPSHOT_VERSION) {
    return { ok: false, error: `That backup was made by a newer version (v${snap.version}).` };
  }

  try {
    await db.transaction("rw", db.tables, async () => {
      for (const name of TABLES) {
        const rows = (snap.tables?.[name] ?? []) as unknown[];
        await table(name).clear();
        if (rows.length) await table(name).bulkPut(rows as never[]);
      }
      if (snap.settings) await db.settings.put(snap.settings as never);
    });
  } catch (e) {
    return { ok: false, error: `Restore failed: ${String(e)}` };
  }

  await recordAudit({ action: `Restored a backup from ${snap.exportedAt.slice(0, 10)}` });
  return { ok: true, counts: snap.counts };
}

/* ------------------------------------------------------------------ */
/* Cloud backup                                                        */
/* ------------------------------------------------------------------ */

const WS_KEY = "dr.workspaceId";
const REV_KEY = "dr.workspaceRevision";
const DEVICE_KEY = "dr.deviceName";

export function getWorkspaceId(): string | null {
  return localStorage.getItem(WS_KEY);
}

export function setWorkspaceId(id: string): void {
  localStorage.setItem(WS_KEY, id.trim());
}

export function createWorkspaceId(): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  setWorkspaceId(id);
  return id;
}

export function getDeviceName(): string {
  let d = localStorage.getItem(DEVICE_KEY);
  if (!d) {
    d = `${navigator.platform || "device"} · ${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem(DEVICE_KEY, d);
  }
  return d;
}

function localRevision(): number | null {
  const v = localStorage.getItem(REV_KEY);
  return v ? Number(v) : null;
}

export interface CloudStatus {
  configured: boolean;
  message?: string;
}

export async function cloudStatus(): Promise<CloudStatus> {
  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "pull", workspaceId: "status-probe" }),
    });
    if (res.status === 503) {
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      return { configured: false, message: b.message };
    }
    return { configured: true };
  } catch {
    return { configured: false, message: "Could not reach the backup service." };
  }
}

export type PushResult =
  | { kind: "ok"; revision: number }
  | { kind: "conflict"; serverRevision: number }
  | { kind: "error"; message: string };

export async function pushToCloud(force = false): Promise<PushResult> {
  const workspaceId = getWorkspaceId() ?? createWorkspaceId();
  const snap = await buildSnapshot();
  const payload: Record<string, unknown> = { ...snap.tables, settings: snap.settings };

  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        op: "push",
        workspaceId,
        label: "Doggie Retreat",
        device: getDeviceName(),
        baseRevision: localRevision(),
        payload,
        force,
      }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      return { kind: "error", message: b.message ?? `Backup failed (${res.status}).` };
    }
    const data = (await res.json()) as { ok?: boolean; conflict?: boolean; revision?: number; serverRevision?: number };
    if (data.conflict) return { kind: "conflict", serverRevision: data.serverRevision ?? 0 };
    if (data.revision) localStorage.setItem(REV_KEY, String(data.revision));
    await recordAudit({ action: `Backed up to the cloud (revision ${data.revision})` });
    return { kind: "ok", revision: data.revision ?? 0 };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}

export type PullResult =
  | { kind: "ok"; revision: number; counts: Record<string, number> }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export async function pullFromCloud(): Promise<PullResult> {
  const workspaceId = getWorkspaceId();
  if (!workspaceId) return { kind: "error", message: "No workspace is linked on this device yet." };

  try {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "pull", workspaceId }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { message?: string };
      return { kind: "error", message: b.message ?? `Restore failed (${res.status}).` };
    }
    const data = (await res.json()) as {
      found?: boolean; revision?: number; tables?: Record<string, unknown>;
    };
    if (!data.found) return { kind: "empty" };

    const t = data.tables ?? {};
    const snapshot: Snapshot = {
      format: "doggie-retreat-snapshot",
      version: SNAPSHOT_VERSION,
      exportedAt: new Date().toISOString(),
      counts: {},
      tables: Object.fromEntries(
        TABLES.map((n) => [n, Array.isArray(t[n]) ? (t[n] as unknown[]) : []])
      ),
      settings: t.settings ?? null,
    };
    const report = await restoreSnapshot(JSON.stringify(snapshot));
    if (!report.ok) return { kind: "error", message: report.error ?? "Restore failed." };

    if (data.revision) localStorage.setItem(REV_KEY, String(data.revision));
    const counts = Object.fromEntries(
      TABLES.map((n) => [n, (snapshot.tables[n] ?? []).length])
    );
    return { kind: "ok", revision: data.revision ?? 0, counts };
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}
