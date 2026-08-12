import { useEffect, useState } from "react";
import { Minus, X } from "lucide-react";
import clsx from "clsx";
import CommandBar from "./CommandBar";

/**
 * Karma, available from every screen.
 *
 * The assistant only lived on Home, which meant noticing something on the Walk
 * Planner and wanting to record it required leaving the screen you were
 * looking at — exactly when you are least willing to. Staff work from the
 * planners, so Karma follows them there.
 *
 * It renders the same CommandBar as Home rather than a reduced copy, so the
 * two cannot drift apart: identical modes, voice input, confirmation cards,
 * undo and permission handling.
 */

const OPEN_KEY = "dr.karmaDock.open";

export default function KarmaDock() {
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* storage unavailable — the preference simply will not persist */
    }
  }, [open]);

  // Escape closes it, which is what anyone will try when it is in the way.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open Karma, the canine assistant"
        className="fixed bottom-4 right-4 z-40 flex h-14 items-center gap-2 rounded-full
                   bg-[#141B2B] pl-2 pr-4 text-white shadow-lg ring-1 ring-white/15
                   transition-transform hover:scale-[1.03] focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-brand-400"
      >
        <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white/10 ring-2 ring-brand-500/70">
          <img
            src="/karma-head.png"
            alt=""
            aria-hidden="true"
            className="h-full w-full object-cover"
            style={{ imageRendering: "pixelated" }}
          />
        </span>
        <span className="text-[13px] font-semibold">Ask Karma</span>
      </button>
    );
  }

  return (
    <>
      {/* Backdrop only below sm, where the panel behaves as a bottom sheet and
          would otherwise leave the page tappable underneath. */}
      <button
        className="fixed inset-0 z-40 bg-ink-900/40 sm:hidden"
        aria-label="Close Karma"
        onClick={() => setOpen(false)}
      />

      <div
        role="dialog"
        aria-label="Karma, the canine assistant"
        className={clsx(
          "fixed z-50 flex flex-col overflow-hidden bg-[#141B2B] shadow-2xl ring-1 ring-white/15",
          // Bottom sheet on phones, anchored panel from sm up.
          "inset-x-0 bottom-0 max-h-[85vh] rounded-t-lg",
          "sm:inset-x-auto sm:bottom-4 sm:right-4 sm:w-[420px] sm:max-h-[calc(100vh-6rem)] sm:rounded-lg"
        )}
      >
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
          <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-white/10 ring-1 ring-brand-500/70">
            <img
              src="/karma-head.png"
              alt=""
              aria-hidden="true"
              className="h-full w-full object-cover"
              style={{ imageRendering: "pixelated" }}
            />
          </span>
          <span className="text-[13px] font-semibold text-white">Karma</span>
          <span className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setOpen(false)}
              aria-label="Minimise Karma"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] text-slate-400 hover:bg-white/10 hover:text-white"
            >
              <Minus size={16} />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close Karma"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] text-slate-400 hover:bg-white/10 hover:text-white sm:hidden"
            >
              <X size={16} />
            </button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <CommandBar variant="dock" />
        </div>
      </div>
    </>
  );
}
