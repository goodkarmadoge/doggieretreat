import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Copy, Info, Lock, TriangleAlert, Unlock } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { BehaviorColor, PlanStatus, Reason } from "@/models/types";
import { addDays, formatLong, todayISO } from "@/utils/dates";

/**
 * Colour is never the only signal — every badge carries a letter as well, so
 * status survives colour blindness and a sun-washed screen on the daycare floor.
 */
const COLOR_META: Record<BehaviorColor, { label: string; glyph: string; cls: string; dot: string }> = {
  green:  { label: "Green",  glyph: "G", cls: "bg-signal-greenSoft text-signal-green", dot: "bg-signal-green" },
  yellow: { label: "Yellow", glyph: "Y", cls: "bg-signal-amberSoft text-signal-amber", dot: "bg-signal-amber" },
  red:    { label: "Red",    glyph: "R", cls: "bg-signal-redSoft text-signal-red",     dot: "bg-signal-red" },
};

export function ColorBadge({ color, size = "md" }: { color: BehaviorColor | null; size?: "sm" | "md" }) {
  if (!color) {
    return (
      <span className={clsx(
        "inline-flex items-center gap-1 rounded-full border border-dashed border-ink-300 text-ink-400 font-semibold",
        size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"
      )}>
        <span className="font-mono">?</span> Not assessed
      </span>
    );
  }
  const m = COLOR_META[color];
  return (
    <span className={clsx(
      "inline-flex items-center gap-1 rounded-full font-semibold",
      m.cls,
      size === "sm" ? "px-1.5 py-0 text-[10px]" : "px-2 py-0.5 text-[11px]"
    )}>
      <span className="font-mono">{m.glyph}</span> {m.label}
    </span>
  );
}

export function ColorDot({ color }: { color: BehaviorColor | null }) {
  if (!color) {
    return <span className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-ink-400" />;
  }
  return (
    <span
      className={clsx("inline-block h-2.5 w-2.5 rounded-full", COLOR_META[color].dot)}
      title={COLOR_META[color].label}
    />
  );
}

export function StatusPill({ status }: { status: PlanStatus }) {
  const map = {
    valid:    { label: "Valid",         cls: "bg-signal-greenSoft text-signal-green" },
    warning:  { label: "Needs review",  cls: "bg-signal-amberSoft text-signal-amber" },
    conflict: { label: "Hard conflict", cls: "bg-signal-redSoft text-signal-red" },
  } as const;
  const m = map[status];
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold", m.cls)}>
      {status === "valid" ? <Check size={11} /> : <TriangleAlert size={11} />}
      {m.label}
    </span>
  );
}

export function ReasonList({ reasons }: { reasons: Reason[] }) {
  if (!reasons.length) return null;
  return (
    <ul className="flex flex-col gap-1">
      {reasons.map((r, i) => (
        <li
          key={`${r.code}-${i}`}
          className={clsx(
            "flex items-start gap-1.5 rounded px-2 py-1 text-[12px] leading-snug",
            r.severity === "conflict" && "bg-signal-redSoft text-signal-red",
            r.severity === "warning" && "bg-signal-amberSoft text-signal-amber",
            r.severity === "info" && "bg-ink-50 text-ink-600"
          )}
        >
          {r.severity === "info" ? (
            <Info size={12} className="mt-0.5 shrink-0" />
          ) : (
            <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          )}
          <span>{r.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-[15px] font-semibold text-ink-700">{title}</p>
      {hint && <p className="max-w-md text-[13px] text-ink-500">{hint}</p>}
      {action}
    </div>
  );
}

export function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center rounded border border-ink-300 bg-white">
        <button
          type="button"
          onClick={() => onChange(addDays(date, -1))}
          className="px-2 py-1.5 text-ink-500 hover:text-ink-900"
          aria-label="Previous day"
        >
          <ChevronLeft size={16} />
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => e.target.value && onChange(e.target.value)}
          className="border-x border-ink-200 px-2 py-1.5 text-[13px] font-semibold font-mono"
          aria-label="Select date"
        />
        <button
          type="button"
          onClick={() => onChange(addDays(date, 1))}
          className="px-2 py-1.5 text-ink-500 hover:text-ink-900"
          aria-label="Next day"
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <button type="button" className="btn btn-sm" onClick={() => onChange(todayISO())}>
        Today
      </button>
      <span className="text-[13px] text-ink-500">{formatLong(date)}</span>
    </div>
  );
}

export function CopyButton({ text, label = "Copy summary" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function LockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx("btn btn-sm", locked && "border-brand-500 text-brand-700 bg-brand-50")}
      title={locked ? "Unlock so regenerate can change this" : "Lock so regenerate preserves this"}
    >
      {locked ? <Lock size={13} /> : <Unlock size={13} />}
      {locked ? "Locked" : "Lock"}
    </button>
  );
}

export function StatCard({
  label, value, tone = "neutral", hint,
}: {
  label: string; value: ReactNode; tone?: "neutral" | "green" | "amber" | "red" | "brand"; hint?: string;
}) {
  // Large charcoal value by default; status colour only on the metric that
  // actually needs it, so the eye goes to what requires attention.
  const tones = {
    neutral: "text-ink-900",
    green: "text-signal-green",
    amber: "text-signal-amber",
    red: "text-signal-red",
    brand: "text-brand-600",
  } as const;
  return (
    <div className="card flex flex-col gap-1 px-4 py-3">
      <span className="label-xs">{label}</span>
      <span className={clsx("text-[26px] font-bold leading-none tracking-tight", tones[tone])}>
        {value}
      </span>
      {hint && <span className="text-[11px] text-ink-500">{hint}</span>}
    </div>
  );
}

export function DemoBanner() {
  // Informational, not dangerous — so a pale pink surface rather than an
  // amber warning banner. Amber is kept for real operational warnings.
  return (
    <div className="notice">
      <b>Demo data.</b> Dogs, owners and behaviour records are fictional. Floor capacities,
      the walker roster and every behaviour colour are synthetic demo values, not Doggie
      Retreat policy.
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-[15px] font-bold tracking-tight text-ink-900">{children}</h2>
      {right}
    </div>
  );
}
