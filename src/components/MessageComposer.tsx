import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import clsx from "clsx";

/**
 * Preview and edit the message that gets pasted into WhatsApp.
 *
 * Two things this has to get right:
 *
 *  1. Show what WhatsApp will actually render, not the raw markup. Staff should
 *     not have to imagine what `*Sarah*` looks like once sent.
 *  2. Never silently discard a manual edit. The plan regenerates whenever
 *     attendance or conflicts change, and overwriting someone's typed note the
 *     moment a dog is marked absent would be the fastest way to make this
 *     feature untrustworthy. Instead the edit is kept and the change is
 *     announced, leaving the choice with the person.
 */

export interface MessageComposerProps {
  /** Freshly generated message for the current plan. */
  generated: string;
  /** Scopes the saved draft, e.g. "walk:2026-08-12". */
  storageKey: string;
  title?: string;
  hint?: string;
}

interface Saved {
  text: string;
  /** The generated message this edit was made against. */
  basedOn: string;
}

function load(key: string): Saved | null {
  try {
    const raw = localStorage.getItem(`dr.msg.${key}`);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

function save(key: string, value: Saved | null) {
  try {
    if (value) localStorage.setItem(`dr.msg.${key}`, JSON.stringify(value));
    else localStorage.removeItem(`dr.msg.${key}`);
  } catch {
    /* storage unavailable — the draft simply will not persist */
  }
}

export default function MessageComposer({
  generated,
  storageKey,
  title = "WhatsApp message",
  hint,
}: MessageComposerProps) {
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const [saved, setSaved] = useState<Saved | null>(() => load(storageKey));
  const [copied, setCopied] = useState(false);

  // Switching date or plan pulls the matching draft, if there is one.
  useEffect(() => {
    setSaved(load(storageKey));
    setTab("preview");
  }, [storageKey]);

  const edited = saved !== null;
  const text = edited ? saved.text : generated;
  const planMovedOn = edited && saved.basedOn !== generated;

  const setText = (next: string) => {
    const value: Saved = { text: next, basedOn: saved?.basedOn ?? generated };
    setSaved(value);
    save(storageKey, value);
  };

  const reset = () => {
    setSaved(null);
    save(storageKey, null);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API is blocked in some embedded/insecure contexts.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const rendered = useMemo(() => renderWhatsApp(text), [text]);
  const lineCount = text.split("\n").length;

  return (
    <section className="card flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
          {hint && <p className="text-[12px] text-ink-500">{hint}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-0.5 rounded bg-ink-100 p-0.5">
            {(["preview", "edit"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className={clsx(
                  "rounded px-3 py-1 text-[12px] font-semibold capitalize",
                  tab === t ? "bg-white text-ink-900 shadow-sm" : "text-ink-500"
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {edited && (
            <button className="btn btn-sm" onClick={reset} title="Discard edits and rebuild from the plan">
              <RotateCcw size={12} /> Reset
            </button>
          )}

          <button className="btn btn-sm btn-primary" onClick={copy}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy for WhatsApp"}
          </button>
        </div>
      </div>

      {planMovedOn && (
        <p className="flex flex-wrap items-center gap-2 rounded border border-signal-amber/40 bg-signal-amberSoft px-3 py-2 text-[12.5px] text-signal-amber">
          <span>
            The walk plan has changed since you edited this, so your version is now out of date.
            Your edits have been kept rather than overwritten.
          </span>
          <button className="ml-auto font-semibold underline" onClick={reset}>
            Rebuild from the current plan
          </button>
        </p>
      )}

      {tab === "preview" ? (
        <div className="rounded-md border border-ink-200 bg-[#ECE5DD] p-3">
          {/* Approximate WhatsApp's outgoing bubble so spacing and emphasis
              can be judged before sending, not after. */}
          <div className="ml-auto max-w-[420px] rounded-lg rounded-tr-sm bg-[#DCF8C6] px-3 py-2 shadow-sm">
            <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.45] text-[#111B21]">
              {rendered}
            </pre>
            <div className="mt-1 text-right text-[10px] text-[#667781]">
              {new Date().toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false })} ✓✓
            </div>
          </div>
        </div>
      ) : (
        <textarea
          className="input min-h-[320px] font-mono text-[12.5px] leading-[1.5]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label="Edit the WhatsApp message"
        />
      )}

      <p className="text-[11px] text-ink-400">
        {lineCount} lines · {text.length} characters
        {edited && " · edited"}
        {" · "}
        <span className="font-mono">*bold*</span>, <span className="font-mono">_italic_</span> and{" "}
        <span className="font-mono">~strikethrough~</span> are WhatsApp formatting.
      </p>
    </section>
  );
}

/**
 * Render WhatsApp's inline formatting. Built as React nodes rather than
 * injected HTML so message content can never become markup.
 */
function renderWhatsApp(text: string): ReactNode[] {
  const pattern = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(pattern)) {
    const idx = match.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const token = match[0];
    const inner = token.startsWith("```") ? token.slice(3, -3) : token.slice(1, -1);

    if (token.startsWith("*")) {
      out.push(<strong key={key++} className="font-bold">{inner}</strong>);
    } else if (token.startsWith("_")) {
      out.push(<em key={key++}>{inner}</em>);
    } else if (token.startsWith("~")) {
      out.push(<s key={key++}>{inner}</s>);
    } else {
      out.push(<code key={key++} className="font-mono text-[12px]">{inner}</code>);
    }
    last = idx + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
