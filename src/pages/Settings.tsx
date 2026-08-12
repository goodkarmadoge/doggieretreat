import { useEffect, useState } from "react";
import {
  CloudDownload, CloudUpload, Download, Plus, RefreshCw, Trash2, Upload as UploadIcon,
} from "lucide-react";
import clsx from "clsx";
import { PageShell } from "@/App";
import { ColorBadge, SectionTitle } from "@/components/ui";
import {
  useAudit, useDogs, useFloors, useRecurring, useReviewQueue, useSettings, useWalkers,
} from "@/hooks/useData";
import { db } from "@/db/database";
import { ROLE_LABEL, type StaffRole } from "@/services/harness/intents";
import { confirmAction, runHarness } from "@/services/harness/pipeline";
import {
  cloudStatus, downloadSnapshot, getWorkspaceId, pullFromCloud, pushToCloud,
  restoreSnapshot, setWorkspaceId, type CloudStatus,
} from "@/services/backup/backup";
import { todayISO } from "@/utils/dates";
import {
  clearAllData, deleteWalker, loadDemoData, updateSettings, upsertFloor, upsertWalker,
} from "@/db/repository";
import type { RedVanPolicy } from "@/models/types";

const RED_VAN_OPTIONS: { value: RedVanPolicy; label: string; help: string }[] = [
  { value: "review", label: "Flag for staff review", help: "Default. No van rule for Red dogs has been agreed, so the system will not guess." },
  { value: "solo", label: "Solo van run", help: "A Red dog rides alone. Mirrors the 1:1 walk rule." },
  { value: "crated", label: "Share, crated, no flagged conflicts", help: "Rides with others when crated and no incompatible dog is aboard." },
  { value: "normal", label: "Same as any dog", help: "Only explicit incompatibility applies." },
];

export default function SettingsPage() {
  const settings = useSettings();
  const walkers = useWalkers();
  const floors = useFloors();
  const audit = useAudit(40);
  const reviewQueue = useReviewQueue();
  const dogs = useDogs();
  const recurring = useRecurring();
  const [newWalker, setNewWalker] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [retryNote, setRetryNote] = useState<{ id: string; ok: boolean; message: string } | null>(null);

  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [wsInput, setWsInput] = useState("");
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(getWorkspaceId());
  const [backupNote, setBackupNote] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    cloudStatus().then((s) => !cancelled && setCloud(s));
    return () => { cancelled = true; };
  }, []);

  const doExport = async () => {
    try {
      const name = await downloadSnapshot();
      setBackupNote({ ok: true, message: `Saved ${name}` });
    } catch (e) {
      setBackupNote({ ok: false, message: `Export failed: ${String(e)}` });
    }
  };

  const doPush = async () => {
    setSyncing(true);
    setBackupNote(null);
    try {
      let res = await pushToCloud();
      if (res.kind === "conflict") {
        const ok = confirm(
          `Another device has backed up more recently (revision ${res.serverRevision}).\n\n` +
          `Overwrite it with what's on this device?\n\n` +
          `Cancel to leave the cloud copy alone — you can pull it instead.`
        );
        if (!ok) {
          setBackupNote({ ok: false, message: "Backup cancelled. The cloud copy is untouched." });
          return;
        }
        res = await pushToCloud(true);
      }
      if (res.kind === "ok") {
        setWorkspaceIdState(getWorkspaceId());
        setBackupNote({ ok: true, message: `Backed up (revision ${res.revision}).` });
      } else if (res.kind === "error") {
        setBackupNote({ ok: false, message: res.message });
      }
    } finally {
      setSyncing(false);
    }
  };

  const doPull = async () => {
    if (!confirm("Restoring replaces everything currently in this browser. Continue?")) return;
    setSyncing(true);
    setBackupNote(null);
    try {
      const res = await pullFromCloud();
      if (res.kind === "ok") {
        const total = Object.values(res.counts).reduce((a, b) => a + b, 0);
        setBackupNote({ ok: true, message: `Restored ${total} records from revision ${res.revision}.` });
      } else if (res.kind === "empty") {
        setBackupNote({ ok: false, message: "That workspace has no backup yet." });
      } else {
        setBackupNote({ ok: false, message: res.message });
      }
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Put a queued message back through the harness under the current role.
   * Auto-apply actions land immediately; confirm-tier ones are applied here
   * because a lead re-running an item IS the confirmation.
   */
  const retryReview = async (id: string, sourceText: string) => {
    setRetrying(id);
    setRetryNote(null);
    try {
      const ctx = {
        today: todayISO(),
        dogs,
        recurring,
        floors,
        walkers,
        vanCount: settings.vanCount,
        role: settings.staffRole ?? "shift_lead",
      };
      const res = await runHarness(sourceText, ctx, { useLlm: true });
      if (res.kind === "applied") {
        await db.reviewQueue.update(id, { resolved: true });
        setRetryNote({ id, ok: true, message: `Applied — ${res.action.preview}` });
      } else if (res.kind === "confirm") {
        await confirmAction(res.action, ctx, res.meta);
        await db.reviewQueue.update(id, { resolved: true });
        setRetryNote({ id, ok: true, message: `Approved — ${res.action.preview}` });
      } else if (res.kind === "ambiguous") {
        setRetryNote({ id, ok: false, message: `Still ambiguous: "${res.token}" matches ${res.candidates.length} dogs. Resolve it from Karma on Today.` });
      } else {
        setRetryNote({ id, ok: false, message: res.item.message });
      }
    } catch (e) {
      setRetryNote({ id, ok: false, message: String(e) });
    } finally {
      setRetrying(null);
    }
  };

  return (
    <PageShell title="Settings" description="Operational configuration. Demo values are labelled.">
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card flex flex-col gap-3 p-3">
          <SectionTitle>Walks</SectionTitle>
          <label className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">Maximum dogs per walker</span>
            <input
              type="number" min={1} max={8}
              className="w-20 rounded border border-ink-300 px-2 py-1 text-right font-mono text-[13px]"
              value={settings.maxDogsPerWalker}
              onChange={(e) => updateSettings({ maxDogsPerWalker: Math.max(1, Number(e.target.value)) })}
            />
          </label>
          <p className="text-[11.5px] text-ink-400">
            Demo default is 4. One wave per day — each available walker takes at most one group,
            so daily capacity is walkers × this number, minus a walker for every 1:1 dog.
          </p>

          <div className="border-t border-ink-200 pt-2">
            <span className="label-xs">Walker roster · demo staff</span>
            <ul className="mt-1 flex flex-col gap-1">
              {walkers.map((w) => (
                <li key={w.id} className="flex flex-wrap items-center gap-2 rounded bg-ink-50 px-2 py-1.5">
                  <span className="flex-1 text-[13px] font-semibold">{w.name}</span>
                  <label className="flex items-center gap-1 text-[11.5px] text-ink-600">
                    <input
                      type="checkbox" checked={w.available}
                      onChange={(e) => upsertWalker({ ...w, available: e.target.checked })}
                    />
                    Available
                  </label>
                  <label className="flex items-center gap-1 text-[11.5px] text-ink-600">
                    <input
                      type="checkbox" checked={w.experienced}
                      onChange={(e) => upsertWalker({ ...w, experienced: e.target.checked })}
                    />
                    Experienced
                  </label>
                  <button onClick={() => deleteWalker(w.id)} aria-label={`Remove ${w.name}`}>
                    <Trash2 size={13} className="text-ink-400 hover:text-signal-red" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Add a walker…"
                value={newWalker}
                onChange={(e) => setNewWalker(e.target.value)}
              />
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!newWalker.trim()) return;
                  upsertWalker({
                    id: `w-${Date.now().toString(36)}`,
                    name: newWalker.trim(),
                    available: true, experienced: false, isDemo: false,
                  });
                  setNewWalker("");
                }}
              >
                <Plus size={13} /> Add
              </button>
            </div>
          </div>
        </section>

        <section className="card flex flex-col gap-3 p-3">
          <SectionTitle>Floors</SectionTitle>
          <p className="text-[11.5px] text-ink-400">
            Capacities below are synthetic demo values, not Doggie Retreat's actual numbers.
          </p>
          {floors.map((f) => (
            <div key={f.id} className="flex flex-col gap-1.5 rounded bg-ink-50 p-2">
              <div className="flex items-center gap-2">
                <input
                  className="input flex-1"
                  value={f.name}
                  onChange={(e) => upsertFloor({ ...f, name: e.target.value })}
                  aria-label="Floor name"
                />
                <input
                  type="number" min={0}
                  className="w-20 rounded border border-ink-300 px-2 py-1.5 text-right font-mono text-[13px]"
                  value={f.capacity}
                  onChange={(e) => upsertFloor({ ...f, capacity: Math.max(0, Number(e.target.value)) })}
                  aria-label="Capacity"
                />
              </div>
              <input
                className="input"
                placeholder="Operational characteristics…"
                value={f.restrictions ?? ""}
                onChange={(e) => upsertFloor({ ...f, restrictions: e.target.value })}
              />
            </div>
          ))}
        </section>

        <section className="card flex flex-col gap-3 p-3">
          <SectionTitle>Transportation</SectionTitle>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Facility name</span>
            <input
              className="input" value={settings.facilityName}
              onChange={(e) => updateSettings({ facilityName: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="label-xs">Facility address</span>
            <input
              className="input" value={settings.facilityAddress}
              onChange={(e) => updateSettings({ facilityAddress: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="flex flex-col gap-1">
              <span className="label-xs">Latitude</span>
              <input
                type="number" step="0.0001"
                className="input font-mono" value={settings.facilityLat}
                onChange={(e) => updateSettings({ facilityLat: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-xs">Longitude</span>
              <input
                type="number" step="0.0001"
                className="input font-mono" value={settings.facilityLng}
                onChange={(e) => updateSettings({ facilityLng: Number(e.target.value) })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="label-xs">Vans</span>
              <input
                type="number" min={1} max={6}
                className="input font-mono" value={settings.vanCount}
                onChange={(e) => updateSettings({ vanCount: Math.max(1, Number(e.target.value)) })}
              />
            </label>
          </div>
          <label className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold">Van capacity</span>
            <span className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-[11.5px] text-ink-600">
                <input
                  type="checkbox"
                  checked={settings.vanCapacity === null}
                  onChange={(e) => updateSettings({ vanCapacity: e.target.checked ? null : 8 })}
                />
                Unlimited
              </label>
              {settings.vanCapacity !== null && (
                <input
                  type="number" min={1}
                  className="w-20 rounded border border-ink-300 px-2 py-1 text-right font-mono text-[13px]"
                  value={settings.vanCapacity}
                  onChange={(e) => updateSettings({ vanCapacity: Math.max(1, Number(e.target.value)) })}
                />
              )}
            </span>
          </label>
        </section>

        <section className="card flex flex-col gap-2 p-3">
          <SectionTitle>Behaviour colours</SectionTitle>
          <div className="flex flex-col gap-2 text-[12.5px]">
            <p className="flex items-start gap-2">
              <ColorBadge color="green" size="sm" />
              <span className="text-ink-600">
                Can generally be grouped with other dogs. An explicit incompatibility still wins.
                <b> This rule is defined.</b>
              </span>
            </p>
            <p className="flex items-start gap-2">
              <ColorBadge color="yellow" size="sm" />
              <span className="text-ink-600">
                Conditional behaviour driven by per-dog constraints. Doggie Retreat's full Yellow
                policy is <b>not yet defined</b> — incomplete cases surface as Needs Staff Review.
              </span>
            </p>
            <p className="flex items-start gap-2">
              <ColorBadge color="red" size="sm" />
              <span className="text-ink-600">
                Walks 1:1 with a handler — <b>this rule is defined</b>. Floor and van rules are
                <b> not</b>, so those placements route to staff review until configured.
              </span>
            </p>
          </div>

          <div className="border-t border-ink-200 pt-2">
            <span className="label-xs">Red dogs in the van</span>
            <div className="mt-1 flex flex-col gap-1">
              {RED_VAN_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  onClick={() => updateSettings({ redVanPolicy: o.value })}
                  aria-pressed={settings.redVanPolicy === o.value}
                  className={clsx(
                    "rounded border p-2 text-left",
                    settings.redVanPolicy === o.value
                      ? "border-brand-500 bg-brand-50"
                      : "border-ink-200 hover:border-ink-300"
                  )}
                >
                  <span className="text-[12.5px] font-semibold">{o.label}</span>
                  <span className="block text-[11.5px] text-ink-500">{o.help}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Data durability. Everything lives in one browser, so this is the only
          thing standing between a cleared cache and losing all enrichment. */}
      <section className="card flex flex-col gap-3 p-3">
        <SectionTitle
          right={
            <span className="text-[11.5px] text-ink-500">
              {cloud === null ? "Checking…" : cloud.configured ? "Cloud backup available" : "Local backup only"}
            </span>
          }
        >
          Backup &amp; restore
        </SectionTitle>
        <p className="text-[12px] text-ink-500">
          Doggie Retreat keeps its records in this browser. Clearing site data would erase
          every behaviour colour, conflict flag and schedule with no way back — so take a
          backup before you rely on it.
        </p>

        {backupNote && (
          <p
            className={clsx(
              "rounded px-3 py-2 text-[12.5px] font-semibold",
              backupNote.ok
                ? "bg-signal-greenSoft text-signal-green"
                : "bg-signal-redSoft text-signal-red"
            )}
          >
            {backupNote.message}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="label-xs">On this device</span>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={doExport}>
              <Download size={13} /> Download a backup
            </button>
            <label className="btn cursor-pointer">
              <UploadIcon size={13} /> Restore from a file
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (!confirm("Restoring replaces everything currently in this browser. Continue?")) return;
                  const report = await restoreSnapshot(await f.text());
                  setBackupNote(
                    report.ok
                      ? { ok: true, message: "Backup restored." }
                      : { ok: false, message: report.error ?? "Restore failed." }
                  );
                }}
              />
            </label>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-ink-200 pt-2.5">
          <span className="label-xs">Cloud backup</span>
          {cloud && !cloud.configured ? (
            <p className="rounded bg-ink-100 px-3 py-2 text-[12px] text-ink-600">
              {cloud.message ?? "Not configured."}
            </p>
          ) : (
            <>
              <p className="text-[11.5px] text-ink-500">
                Workspace <span className="font-mono">{workspaceId ?? "not linked yet"}</span>. Paste
                this id on another device to load the same dataset there.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button className="btn btn-primary" disabled={syncing} onClick={doPush}>
                  <CloudUpload size={13} /> {syncing ? "Working…" : "Back up now"}
                </button>
                <button className="btn" disabled={syncing || !workspaceId} onClick={doPull}>
                  <CloudDownload size={13} /> Restore from cloud
                </button>
                <input
                  className="input w-[290px] font-mono text-[11.5px]"
                  placeholder="Paste a workspace id to link this device…"
                  value={wsInput}
                  onChange={(e) => setWsInput(e.target.value)}
                  aria-label="Workspace id"
                />
                <button
                  className="btn btn-sm"
                  disabled={!wsInput.trim()}
                  onClick={() => {
                    setWorkspaceId(wsInput.trim());
                    setWorkspaceIdState(wsInput.trim());
                    setWsInput("");
                    setBackupNote({ ok: true, message: "Device linked. Use “Restore from cloud” to pull the data." });
                  }}
                >
                  Link
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="card flex flex-wrap items-center gap-2 p-3">
        <SectionTitle>Dataset</SectionTitle>
        <div className="flex flex-1 flex-wrap justify-end gap-2">
          <button className="btn" onClick={() => loadDemoData()}>Reload demo data</button>
          <button
            className="btn border-signal-red text-signal-red"
            onClick={() => {
              if (confirm("Delete every dog, schedule and plan in this browser?")) clearAllData();
            }}
          >
            Clear all data
          </button>
        </div>
      </section>

      {/* AI harness — permission model (§8) and the review queue (§5 Stage 5) */}
      <section className="card flex flex-col gap-3 p-3">
        <SectionTitle
          right={
            <span className="flex items-center gap-1.5 text-[11.5px] text-ink-500">
              <img src="/karma-head.png" alt="" aria-hidden="true"
                   className="h-5 w-5 rounded-full" style={{ imageRendering: "pixelated" }} />
              Karma, Canine Assistant
            </span>
          }
        >
          Who is on shift
        </SectionTitle>
        <p className="text-[11.5px] text-ink-400">
          Karma checks this before applying anything. Higher-risk actions are queued for
          approval rather than refused outright, so nothing a caretaker asks for is lost.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => (
            <button
              key={r}
              onClick={() => updateSettings({ staffRole: r })}
              aria-pressed={(settings.staffRole ?? "shift_lead") === r}
              className={clsx(
                "rounded border p-2 text-left",
                (settings.staffRole ?? "shift_lead") === r
                  ? "border-brand-500 bg-brand-50"
                  : "border-ink-200 hover:border-ink-300"
              )}
            >
              <span className="text-[12.5px] font-semibold">{ROLE_LABEL[r]}</span>
              <span className="mt-0.5 block text-[11px] text-ink-500">
                {r === "caretaker" && "Attendance, walk groups and floors apply straight away."}
                {r === "shift_lead" && "Can also approve incompatibility flags and reschedules."}
                {r === "admin" && "Can also remove safety flags and record medical notes."}
              </span>
            </button>
          ))}
        </div>

        <div className="border-t border-ink-200 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="label-xs">Needs staff review</span>
            <span className="text-[11.5px] text-ink-500">
              {reviewQueue.length === 0
                ? "Nothing waiting"
                : `${reviewQueue.length} waiting`}
            </span>
          </div>
          {reviewQueue.length === 0 ? (
            <p className="mt-1 text-[12px] text-ink-400">
              Anything Karma can't map to an approved action lands here with the original
              wording, rather than being guessed at or dropped.
            </p>
          ) : (
            <ul className="mt-2 flex max-h-[260px] flex-col gap-2 overflow-y-auto">
              {reviewQueue.map((r) => (
                <li key={r.id} className="rounded border border-ink-200 bg-ink-50 p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-signal-amberSoft px-2 py-0.5 text-[10px] font-bold text-signal-amber">
                      {r.reason.replace(/_/g, " ")}
                    </span>
                    <span className="font-mono text-[10.5px] text-ink-400">
                      {new Date(r.createdAt).toLocaleString("en-SG")}
                    </span>
                    <button
                      className="ml-auto text-[11.5px] font-semibold text-ink-500 hover:text-ink-800"
                      onClick={() => db.reviewQueue.update(r.id, { resolved: true })}
                    >
                      Dismiss
                    </button>
                  </div>
                  <p className="mt-1 font-mono text-[11.5px] text-ink-700">“{r.sourceText}”</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-500">{r.message}</p>

                  {/*
                    Queued items used to be a dead end — a lead could only mark
                    them handled, then redo the work by hand. Re-running puts
                    the original wording back through the full pipeline under
                    the current role, so a permission-blocked action can simply
                    be approved.
                  */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <button
                      className="btn btn-sm btn-secondary"
                      disabled={retrying === r.id}
                      onClick={() => retryReview(r.id, r.sourceText)}
                    >
                      <RefreshCw size={11} />
                      {retrying === r.id ? "Re-running…" : "Re-run as " + ROLE_LABEL[settings.staffRole ?? "shift_lead"].split(" ")[0]}
                    </button>
                    {retryNote?.id === r.id && (
                      <span
                        className={clsx(
                          "text-[11.5px] font-semibold",
                          retryNote.ok ? "text-signal-green" : "text-signal-amber"
                        )}
                      >
                        {retryNote.message}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card p-3">
        <SectionTitle>Audit trail</SectionTitle>
        <p className="mt-0.5 text-[11.5px] text-ink-400">
          Prototype has no authentication; every action is recorded as “Staff User”.
        </p>
        {audit.length === 0 ? (
          <p className="mt-2 text-[12px] text-ink-400">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-2 flex max-h-[320px] flex-col gap-1 overflow-y-auto">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-2 border-b border-ink-100 pb-1 text-[12.5px] last:border-0">
                <span className="font-mono text-[11px] text-ink-400">
                  {new Date(a.timestamp).toLocaleString("en-SG")}
                </span>
                <span className="font-semibold">{a.action}</span>
                {a.dogName && <span className="text-ink-600">{a.dogName}</span>}
                {(a.previousValue || a.newValue) && (
                  <span className="text-ink-500">{a.previousValue ?? "—"} → {a.newValue ?? "—"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageShell>
  );
}
