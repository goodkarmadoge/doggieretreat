import { useEffect, useRef, useState } from "react";
import {
  Check, CornerDownLeft, Cpu, Mic, ShieldCheck, Square, Undo2, X,
} from "lucide-react";
import clsx from "clsx";
import { useDogs, useFloors, useRecurring, useSettings, useWalkers } from "@/hooks/useData";
import { useOperatingDate } from "@/App";
import {
  runHarness, confirmAction, type PipelineMeta, type PipelineResult,
} from "@/services/harness/pipeline";
import { llmAvailable } from "@/services/harness/llmInterpreter";
import { INTENTS, type HarnessAction } from "@/services/harness/intents";
import {
  describeError, isDictationSupported, startDictation,
  type DictationError, type DictationSession,
} from "@/services/voice/speech";
import { snapToRoster, type SnapCorrection } from "@/services/voice/snapToRoster";
import { db } from "@/db/database";

const EXAMPLES = [
  "Luna cannot be grouped with Mochi",
  "Move Mochi from Monday to Wednesday going forward",
  "Put Bailey on Van 2",
  "Bear isn't coming in today",
  "Change Buddy to yellow",
];

/**
 * Karma — the caretaker-facing end of the AI harness.
 *
 * Deliberately dark against the pink workspace. Everywhere else in this app is
 * a white card you read; this is the one surface you talk to, and the contrast
 * is what tells staff it behaves differently. Pink stays the accent so it still
 * reads as Doggie Retreat rather than as a generic AI panel.
 *
 * Nothing typed here reaches an instruction channel — see harness/systemPrompt.
 */
export default function CommandBar() {
  const dogs = useDogs();
  const recurring = useRecurring();
  const floors = useFloors();
  const walkers = useWalkers();
  const settings = useSettings();
  const { date } = useOperatingDate();

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PipelineResult | null>(null);
  const [llmOn, setLlmOn] = useState<boolean | null>(null);
  const [applied, setApplied] = useState<
    { label: string; undo: () => Promise<void>; warnings: string[]; meta: PipelineMeta } | null
  >(null);

  // Probe once so the header can say honestly whether a model is behind Karma.
  useEffect(() => {
    let cancelled = false;
    llmAvailable().then((v) => !cancelled && setLlmOn(v));
    return () => { cancelled = true; };
  }, []);

  /* ---------------- dictation ---------------- */

  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [micError, setMicError] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<SnapCorrection[]>([]);
  const session = useRef<DictationSession | null>(null);
  const micSupported = isDictationSupported();

  // Never leave the mic open if the component goes away mid-utterance.
  useEffect(() => () => session.current?.abort(), []);

  const rosterNames = [
    ...dogs.filter((d) => d.active).map((d) => d.name),
    ...walkers.map((w) => w.name),
  ];

  const stopListening = () => {
    session.current?.stop();
    session.current = null;
    setListening(false);
    setInterim("");
  };

  const startListening = () => {
    setMicError(null);
    setCorrections([]);
    setOutcome(null);
    setApplied(null);
    setInterim("");
    setListening(true);

    session.current = startDictation({
      onInterim: (t) => setInterim(t),
      onFinal: (raw) => {
        // Snap mangled names back to the roster before the harness sees it.
        const { text, corrections: fixes } = snapToRoster(raw, rosterNames);
        setCorrections(fixes);
        setInput(text);
        setInterim("");
        setListening(false);
        session.current = null;
        // Hands are full — submit straight away. Every consequential action
        // still shows a confirm card, and auto-apply ones carry Undo, so the
        // safety net is unchanged.
        void send(text);
      },
      onError: (e: DictationError) => {
        setMicError(describeError(e));
        setListening(false);
        setInterim("");
        session.current = null;
      },
      onEnd: () => {
        setListening(false);
        setInterim("");
        session.current = null;
      },
    });
  };

  const ctx = {
    today: date,
    dogs,
    recurring,
    floors,
    walkers,
    vanCount: settings.vanCount,
    role: settings.staffRole ?? "shift_lead",
  };

  const send = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true);
    setApplied(null);
    try {
      const res = await runHarness(text, ctx, { useLlm: llmOn !== false });
      if (res.kind === "applied") {
        setApplied({
          label: res.action.preview,
          undo: res.undo,
          warnings: res.warnings,
          meta: res.meta,
        });
        setOutcome(null);
        setInput("");
      } else {
        setOutcome(res);
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (action: HarnessAction, meta: PipelineMeta) => {
    setBusy(true);
    try {
      await confirmAction(action, ctx, meta);
      setApplied({ label: action.preview, undo: async () => {}, warnings: [], meta });
      setOutcome(null);
      setInput("");
    } finally {
      setBusy(false);
    }
  };

  const pickCandidate = (name: string) => {
    const token = outcome?.kind === "ambiguous" ? outcome.token : "";
    const rewritten = input.replace(new RegExp(token.trim(), "i"), name);
    setInput(rewritten);
    void send(rewritten);
  };

  const tierBadge = (a: HarnessAction) => {
    const def = INTENTS[a.intent];
    const map = {
      auto_apply: { t: "Applies immediately", c: "bg-emerald-400/15 text-emerald-300" },
      confirm: { t: "Needs your confirmation", c: "bg-pink-400/15 text-pink-200" },
      admin_only: { t: "Admin approval", c: "bg-amber-400/15 text-amber-200" },
    } as const;
    return map[def.risk];
  };

  return (
    <section className="overflow-hidden rounded-lg bg-[#141B2B] shadow-lg ring-1 ring-white/10">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 ring-2 ring-brand-500/70">
          <img
            src="/karma-head.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
            style={{ imageRendering: "pixelated" }}
          />
        </span>
        <span className="flex flex-col">
          <span className="text-[14px] font-semibold text-white">Karma</span>
          <span className="text-[11.5px] text-slate-400">
            Canine Assistant · tell me what changed and I'll do the paperwork
          </span>
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className={clsx(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold",
              llmOn
                ? "bg-brand-500/20 text-brand-200"
                : "bg-white/5 text-slate-400"
            )}
            title={
              llmOn
                ? "Gemini reads your wording. Every action still passes the same validation, permission and confirmation checks."
                : "No model configured — Karma is using built-in phrase matching."
            }
          >
            <Cpu size={12} />
            {llmOn === null ? "Checking…" : llmOn ? "Gemini" : "Offline matching"}
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-[10.5px] font-semibold text-slate-300">
            <ShieldCheck size={12} className="text-brand-400" />
            {settings.staffRole === "admin"
              ? "Admin"
              : settings.staffRole === "caretaker"
                ? "Caretaker"
                : "Shift lead"}
          </span>
        </span>
      </div>

      {/* input */}
      <div className="px-4 py-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            className="min-w-[200px] flex-1 rounded-[12px] border border-white/15 bg-white/5 px-3.5 py-2.5
                       text-[13.5px] text-white placeholder:text-slate-400
                       focus:border-brand-400 focus:bg-white/10 focus:outline-none
                       focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-0"
            placeholder={listening ? "Listening…" : "Tell Doggie Retreat what you want to change…"}
            value={listening && interim ? interim : input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Tell Karma what you want to change"
            disabled={busy || listening}
          />

          {/* Dictation. The whole point of this control is that a walker's
              hands are full of leads, so it is a large, unmissable target. */}
          {micSupported && (
            <button
              type="button"
              onClick={listening ? stopListening : startListening}
              disabled={busy}
              aria-pressed={listening}
              aria-label={listening ? "Stop listening" : "Speak to Karma"}
              title={listening ? "Stop listening" : "Speak to Karma"}
              className={clsx(
                "inline-flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-full",
                "transition-colors disabled:opacity-60",
                listening
                  ? "animate-pulse bg-brand-500 text-white ring-4 ring-brand-500/30"
                  : "border border-white/20 bg-white/5 text-slate-200 hover:border-brand-400 hover:text-white"
              )}
            >
              {listening ? <Square size={16} /> : <Mic size={18} />}
            </button>
          )}

          <button
            type="submit"
            disabled={busy || listening}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[14px] bg-brand-500 px-4
                       text-[13px] font-semibold text-white hover:bg-brand-400
                       disabled:opacity-60"
          >
            {busy ? "Reading…" : "Ask Karma"} <CornerDownLeft size={13} />
          </button>
        </form>

        {/* Live feedback. Without this the walker has no idea it is working. */}
        {listening && (
          <p
            className="mt-2 flex items-center gap-2 rounded-[10px] bg-brand-500/10 px-3 py-2 text-[12.5px] text-brand-100"
            aria-live="polite"
          >
            <span className="flex h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-400" />
            {interim ? `“${interim}”` : "Listening — say what changed, then pause."}
          </p>
        )}

        {micError && (
          <p className="mt-2 flex items-start gap-2 rounded-[10px] border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[12.5px] text-amber-200">
            <span>{micError}</span>
            <button
              className="ml-auto text-amber-100/70 hover:text-white"
              onClick={() => setMicError(null)}
              aria-label="Dismiss"
            >
              <X size={13} />
            </button>
          </p>
        )}

        {/* Name corrections are surfaced, never silent — dictation gets these
            wrong often enough that a walker must be able to catch it. */}
        {corrections.length > 0 && (
          <p className="mt-2 text-[11.5px] text-slate-400">
            Heard and matched to the roster:{" "}
            {corrections.map((c, i) => (
              <span key={i}>
                {i > 0 && ", "}
                <span className="line-through opacity-70">{c.from}</span>
                {" → "}
                <span className="font-semibold text-slate-200">{c.to}</span>
              </span>
            ))}
          </p>
        )}

        {!outcome && !applied && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {EXAMPLES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setInput(c);
                  void send(c);
                }}
                className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11.5px]
                           text-slate-300 hover:border-brand-400 hover:text-white"
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* auto-applied, with undo */}
        {applied && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-emerald-400/30 bg-emerald-400/10 px-3 py-2.5">
            <Check size={15} className="text-emerald-300" />
            <span className="flex-1 text-[12.5px] font-semibold text-emerald-100">
              {applied.label}
            </span>
            <button
              className="inline-flex items-center gap-1 rounded-[10px] border border-white/20 px-2.5 py-1
                         text-[11.5px] font-semibold text-white hover:bg-white/10"
              onClick={async () => {
                await applied.undo();
                setApplied(null);
              }}
            >
              <Undo2 size={12} /> Undo
            </button>
            <button onClick={() => setApplied(null)} aria-label="Dismiss">
              <X size={14} className="text-slate-400 hover:text-white" />
            </button>
            {applied.warnings.length > 0 && (
              <ul className="w-full list-disc pl-5 text-[11.5px] text-emerald-200/80">
                {applied.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
          </div>
        )}

        {/* disambiguation — never guessed */}
        {outcome?.kind === "ambiguous" && (
          <div className="mt-3 rounded-[12px] border border-amber-400/30 bg-amber-400/10 p-3">
            <p className="text-[12.5px] font-semibold text-amber-100">
              “{outcome.token.trim()}” matches {outcome.candidates.length} dogs. Which one?
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {outcome.candidates.map((d) => (
                <button
                  key={d.id}
                  onClick={() => pickCandidate(d.name)}
                  className="rounded-[10px] border border-white/20 px-2.5 py-1 text-[12px] font-semibold text-white hover:bg-white/10"
                >
                  {d.name}
                  <span className="ml-1.5 text-[10px] font-normal text-slate-400">{d.breed}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* routed to a person */}
        {outcome?.kind === "review" && (
          <div className="mt-3 rounded-[12px] border border-white/15 bg-white/5 p-3">
            <p className="text-[12.5px] font-semibold text-white">Sent for review</p>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-300">{outcome.item.message}</p>
            <p className="mt-2 rounded-[8px] bg-black/30 px-2 py-1.5 font-mono text-[11px] text-slate-400">
              “{outcome.item.sourceText}”
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              Nothing was changed. It's in the review queue on Settings with your exact wording kept.
            </p>
            <button className="mt-2 text-[11.5px] font-semibold text-brand-300 hover:text-brand-200"
                    onClick={() => setOutcome(null)}>
              Dismiss
            </button>
          </div>
        )}

        {/* proposed change — plain-English preview before anything happens */}
        {outcome?.kind === "confirm" && (
          <div className="mt-3 rounded-[12px] border border-brand-400/40 bg-brand-500/10 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.09em] text-brand-300">
                Proposed change
              </span>
              <span className={clsx(
                "rounded-full px-2 py-0.5 text-[10px] font-bold",
                tierBadge(outcome.action).c
              )}>
                {tierBadge(outcome.action).t}
              </span>
              <span className="ml-auto font-mono text-[10.5px] text-slate-400">
                {Math.round(outcome.action.confidence * 100)}% confident ·{" "}
                {outcome.meta.interpreter === "gemini" ? outcome.meta.model ?? "gemini" : "built-in"}
              </span>
            </div>

            <p className="mt-1.5 text-[15px] font-bold text-white">{outcome.action.preview}</p>

            {outcome.meta.rationale && (
              <p className="mt-1 text-[11.5px] italic text-slate-400">
                Karma read this as: {outcome.meta.rationale}
              </p>
            )}

            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12px] text-slate-300">
              {outcome.action.detail.map((d, i) => <li key={i}>{d}</li>)}
            </ul>

            {outcome.validation.warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 rounded-[8px] bg-amber-400/10 py-2 pl-7 pr-3 text-[12px] text-amber-200">
                {outcome.validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}

            <dl className="mt-2.5 grid grid-cols-2 gap-x-5 gap-y-1 text-[11.5px] sm:grid-cols-3">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500">Type</dt>
                <dd className="text-slate-300">
                  {outcome.action.recurring ? "Recurring / standing" : "One-time"}
                </dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-slate-500">Scope</dt>
                <dd className="text-slate-300">
                  {INTENTS[outcome.action.intent].scope === "master_db"
                    ? "Standing record"
                    : "Today's plan"}
                </dd>
              </div>
              {outcome.action.effectiveDate && (
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-500">Effective</dt>
                  <dd className="font-mono text-slate-300">{outcome.action.effectiveDate}</dd>
                </div>
              )}
            </dl>

            <p className="mt-2 rounded-[8px] bg-black/30 px-2 py-1.5 font-mono text-[11px] text-slate-400">
              “{outcome.action.source_text}”
            </p>

            <div className="mt-3 flex gap-2">
              <button
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-[12px] bg-brand-500 px-4
                           text-[13px] font-semibold text-white hover:bg-brand-400 disabled:opacity-60"
                onClick={() => confirm(outcome.action, outcome.meta)}
                disabled={busy}
              >
                <Check size={14} /> Apply change
              </button>
              <button
                className="inline-flex min-h-[38px] items-center rounded-[12px] border border-white/20 px-4
                           text-[13px] font-semibold text-slate-200 hover:bg-white/10"
                onClick={() => setOutcome(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export { db };
