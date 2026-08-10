import { useMemo, useRef, useState } from "react";
import { Check, FileUp, Upload } from "lucide-react";
import clsx from "clsx";
import { PageShell } from "@/App";
import { EmptyState, SectionTitle, StatCard } from "@/components/ui";
import { useDogs } from "@/hooks/useData";
import { bulkUpsertDogs, loadDemoData, recordAudit } from "@/db/repository";
import { buildCollarCsvFixture } from "@/demo/demoData";
import {
  FIELD_LABELS, REQUIRED_FIELDS, materialise, parseCsv, planImport, suggestMapping,
  type ImportPlan, type MappableField, type Mapping, type ParsedCsv,
} from "@/services/import/importer";

export default function DataImport() {
  const existing = useDogs();
  const fileRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [committed, setCommitted] = useState<ImportPlan["counts"] | null>(null);

  const plan = useMemo<ImportPlan | null>(
    () => (parsed ? planImport(parsed, mapping, existing) : null),
    [parsed, mapping, existing]
  );

  const ingest = (text: string) => {
    const p = parseCsv(text);
    setParsed(p);
    setMapping(suggestMapping(p.headers));
    setCommitted(null);
  };

  const onFile = async (file: File) => ingest(await file.text());

  const missingRequired = REQUIRED_FIELDS.filter((f) => !mapping[f]);

  const commit = async () => {
    if (!plan || missingRequired.length) return;
    const dogs = materialise(plan, existing);
    await bulkUpsertDogs(dogs);
    await recordAudit({
      action: `Collar import — ${plan.counts.new} new, ${plan.counts.updated} updated, ${plan.counts.unchanged} unchanged`,
    });
    setCommitted(plan.counts);
    setParsed(null);
  };

  return (
    <PageShell
      title="Data Import"
      description="Bring in a Collar CSV. Enriched operational data is never overwritten."
    >
      {committed && (
        <div className="rounded border border-signal-green/40 bg-signal-greenSoft px-3 py-2 text-[13px] text-signal-green">
          <b>Import complete.</b> {committed.new} new · {committed.updated} updated ·{" "}
          {committed.unchanged} unchanged · {committed.duplicate} duplicate rows skipped.
          Behaviour colours, compatibility, schedules, transport and constraints were preserved.
        </div>
      )}

      {!parsed && (
        <div className="grid gap-3 md:grid-cols-2">
          <section
            className="card flex flex-col items-center gap-3 border-dashed p-6 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void onFile(f);
            }}
          >
            <Upload size={22} className="text-ink-400" />
            <div>
              <p className="text-[14px] font-semibold">Upload a Collar CSV</p>
              <p className="text-[12px] text-ink-500">Drop a file here, or choose one.</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onFile(f);
              }}
            />
            <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
              <FileUp size={13} /> Choose CSV
            </button>
          </section>

          <section className="card flex flex-col gap-2 p-4">
            <SectionTitle>No CSV to hand?</SectionTitle>
            <p className="text-[12.5px] text-ink-500">
              Load the demo dataset to get 50 Singapore dogs with schedules, behaviour colours,
              transport preferences and seeded conflicts — enough for every planner to do
              something useful immediately.
            </p>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-primary" onClick={() => loadDemoData()}>
                Load Demo Doggie Retreat Data
              </button>
              <button className="btn" onClick={() => ingest(buildCollarCsvFixture())}>
                Try the import flow with a sample Collar CSV
              </button>
            </div>
            <p className="text-[11.5px] text-ink-400">
              The sample CSV carries only Collar's basic columns. Import it after enriching data
              to prove nothing you entered gets wiped.
            </p>
          </section>
        </div>
      )}

      {parsed && plan && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="New dogs" value={plan.counts.new} tone="brand" />
            <StatCard label="Updated" value={plan.counts.updated} tone="green" />
            <StatCard label="Unchanged" value={plan.counts.unchanged} />
            <StatCard label="Duplicate rows" value={plan.counts.duplicate} tone={plan.counts.duplicate ? "amber" : "neutral"} />
          </div>

          <section className="card flex flex-col gap-2 p-3">
            <SectionTitle>Field mapping</SectionTitle>
            <p className="text-[12px] text-ink-500">
              Columns were matched automatically. Correct anything wrong before importing —
              Collar column names are not assumed.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(Object.keys(FIELD_LABELS) as MappableField[]).map((field) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="label-xs">
                    {FIELD_LABELS[field]}
                    {REQUIRED_FIELDS.includes(field) && <span className="text-signal-red"> *</span>}
                  </span>
                  <select
                    className={clsx(
                      "rounded border bg-white px-2 py-1.5 text-[12.5px]",
                      REQUIRED_FIELDS.includes(field) && !mapping[field]
                        ? "border-signal-red"
                        : "border-ink-300"
                    )}
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping({ ...mapping, [field]: e.target.value || undefined })
                    }
                  >
                    <option value="">— not mapped —</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-ink-50 px-3 py-2">
              <SectionTitle>Preview — first 12 rows</SectionTitle>
              <span className="text-[12px] text-ink-500">{parsed.rows.length} rows in file</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-ink-200 text-ink-500">
                    <th className="px-3 py-2 font-semibold">Dog</th>
                    <th className="px-3 py-2 font-semibold">Owner</th>
                    <th className="px-3 py-2 font-semibold">Outcome</th>
                    <th className="px-3 py-2 font-semibold">Matched by</th>
                    <th className="px-3 py-2 font-semibold">Changes</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.slice(0, 12).map((r) => (
                    <tr key={r.rowIndex} className="border-b border-ink-100 last:border-0">
                      <td className="px-3 py-1.5 font-semibold">{r.incoming.name}</td>
                      <td className="px-3 py-1.5 text-ink-600">{r.incoming.ownerName ?? "—"}</td>
                      <td className="px-3 py-1.5">
                        <span
                          className={clsx(
                            "rounded px-1.5 py-0.5 text-[11px] font-bold",
                            r.outcome === "new" && "bg-brand-50 text-brand-700",
                            r.outcome === "updated" && "bg-signal-greenSoft text-signal-green",
                            r.outcome === "unchanged" && "bg-ink-100 text-ink-500",
                            r.outcome === "duplicate" && "bg-signal-amberSoft text-signal-amber"
                          )}
                        >
                          {r.outcome}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-[11px] text-ink-500">
                        {r.matchedBy ?? (r.duplicateOf ? r.duplicateOf : "—")}
                      </td>
                      <td className="px-3 py-1.5 text-ink-600">
                        {r.changedFields.length ? r.changedFields.join(", ") : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {plan.counts.duplicate > 0 && (
            <p className="rounded border border-signal-amber/40 bg-signal-amberSoft px-3 py-2 text-[12.5px] text-signal-amber">
              {plan.counts.duplicate} row{plan.counts.duplicate === 1 ? "" : "s"} in this file
              duplicate an earlier row. They will be skipped rather than creating a second record.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn btn-primary"
              onClick={commit}
              disabled={missingRequired.length > 0}
            >
              <Check size={13} /> Import{" "}
              {plan.rows.filter((r) => r.outcome !== "duplicate").length} rows
            </button>
            <button className="btn" onClick={() => setParsed(null)}>Cancel</button>
            {missingRequired.length > 0 && (
              <span className="text-[12.5px] text-signal-red">
                Map {missingRequired.map((f) => FIELD_LABELS[f]).join(", ")} before importing.
              </span>
            )}
          </div>
        </>
      )}

      {!parsed && existing.length === 0 && !committed && (
        <div className="card">
          <EmptyState title="No dogs in the database" hint="Import a CSV or load the demo dataset above." />
        </div>
      )}
    </PageShell>
  );
}
