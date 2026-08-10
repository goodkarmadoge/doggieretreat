import { useState } from "react";
import { CornerDownLeft, Sparkles, X } from "lucide-react";
import type { Dog, ParseResult } from "@/models/types";
import { EXAMPLE_COMMANDS, deterministicParser } from "@/services/commandParser/parser";
import { useDogs, useRecurring } from "@/hooks/useData";
import { useOperatingDate } from "@/App";

/**
 * Staff command bar. Nothing commits without a Proposed Change step — the
 * parser is deterministic and will misread things, so the interpretation is
 * always shown before it is applied.
 */
export default function CommandBar() {
  const dogs = useDogs();
  const recurring = useRecurring();
  const { date } = useOperatingDate();

  const [input, setInput] = useState("");
  const [result, setResult] = useState<ParseResult | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (text: string) => {
    setApplied(null);
    setResult(deterministicParser.parse(text, { dogs, recurring, today: date }));
  };

  const apply = async () => {
    if (!result?.change) return;
    setBusy(true);
    try {
      await result.change.apply();
      setApplied(result.change.summary);
      setResult(null);
      setInput("");
    } finally {
      setBusy(false);
    }
  };

  const pickCandidate = (dog: Dog) => {
    const token = result?.ambiguous?.token ?? "";
    const rewritten = input.replace(new RegExp(token.trim(), "i"), dog.name);
    setInput(rewritten);
    run(rewritten);
  };

  return (
    <section className="card flex flex-col gap-3 p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(input);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <Sparkles size={15} className="text-brand-600" />
        <input
          className="input min-w-[240px] flex-1"
          placeholder="Tell Doggie Retreat what you want to change…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="Staff command"
        />
        <button type="submit" className="btn btn-primary">
          Preview <CornerDownLeft size={13} />
        </button>
      </form>

      {!result && !applied && (
        <div className="flex flex-wrap gap-1.5">
          {EXAMPLE_COMMANDS.map((c) => (
            <button
              key={c}
              type="button"
              className="rounded-full border border-dashed border-ink-300 px-2.5 py-1 text-[11.5px] text-ink-500 hover:border-brand-500 hover:text-brand-700"
              onClick={() => {
                setInput(c);
                run(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {applied && (
        <div className="flex items-center justify-between gap-2 rounded bg-signal-greenSoft px-3 py-2 text-[12.5px] font-semibold text-signal-green">
          <span>Applied: {applied}</span>
          <button type="button" onClick={() => setApplied(null)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {result?.ambiguous && (
        <div className="flex flex-col gap-2 rounded border border-signal-amber/40 bg-signal-amberSoft p-3">
          <p className="text-[12.5px] font-semibold text-signal-amber">
            “{result.ambiguous.token.trim()}” matches {result.ambiguous.candidates.length} dogs.
            Which one?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {result.ambiguous.candidates.map((d) => (
              <button key={d.id} type="button" className="btn btn-sm" onClick={() => pickCandidate(d)}>
                {d.name}
                <span className="font-mono text-[10px] text-ink-400">{d.ownerName}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {result && !result.ok && result.error && (
        <p className="rounded bg-signal-redSoft px-3 py-2 text-[12.5px] text-signal-red">
          {result.error}
        </p>
      )}

      {result?.ok && result.change && (
        <div className="flex flex-col gap-2 rounded border border-brand-300 bg-brand-50 p-3">
          <span className="label-xs text-brand-700">Proposed change</span>
          <p className="text-[14px] font-bold text-ink-900">{result.change.summary}</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-3">
            <div>
              <dt className="label-xs">Type</dt>
              <dd className="text-ink-700">
                {result.change.recurring ? "Recurring / permanent" : "One-time"}
              </dd>
            </div>
            {result.change.effectiveDate && (
              <div>
                <dt className="label-xs">Effective</dt>
                <dd className="font-mono text-ink-700">{result.change.effectiveDate}</dd>
              </div>
            )}
            <div>
              <dt className="label-xs">Dogs affected</dt>
              <dd className="text-ink-700">{result.change.dogIds.length}</dd>
            </div>
          </dl>
          <ul className="flex list-disc flex-col gap-0.5 pl-4 text-[12px] text-ink-600">
            {result.change.detail.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary" onClick={apply} disabled={busy}>
              Apply change
            </button>
            <button type="button" className="btn" onClick={() => setResult(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
