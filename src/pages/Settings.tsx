import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import clsx from "clsx";
import { PageShell } from "@/App";
import { ColorBadge, SectionTitle } from "@/components/ui";
import { useAudit, useFloors, useSettings, useWalkers } from "@/hooks/useData";
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
  const [newWalker, setNewWalker] = useState("");

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
