/**
 * Dictation for Karma.
 *
 * A dog walker has both hands full of leads. Typing is the wrong input device
 * for the one job this assistant exists to do, so the mic is not a novelty
 * here — it is the primary input in the field.
 *
 * Web Speech API only. No audio leaves the device beyond the browser's own
 * recognition service, and there is no new backend or dependency.
 */

/* The Web Speech API is not in TypeScript's DOM lib, so the shapes used here
   are declared locally rather than pulling in a types package. */
interface SpeechAlternative { transcript: string; confidence: number }
interface SpeechResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(i: number): SpeechAlternative;
  [i: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  item(i: number): SpeechResult;
  [i: number]: SpeechResult;
}
interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number;
  readonly results: SpeechResultList;
}
interface SpeechRecognitionErrorLike extends Event {
  readonly error: string;
  readonly message?: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  onspeechend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isDictationSupported(): boolean {
  return ctor() !== null;
}

/**
 * Recognition needs a secure context. Localhost counts, so dev works, but a
 * plain-http deployment silently fails — worth saying so rather than showing
 * a mic that does nothing.
 */
export function isSecureForMic(): boolean {
  return window.isSecureContext || location.hostname === "localhost";
}

export type DictationError =
  | "not-supported"
  | "insecure"
  | "no-permission"
  | "no-speech"
  | "no-mic"
  | "network"
  | "unknown";

export function describeError(e: DictationError): string {
  switch (e) {
    case "not-supported":
      return "This browser can't do speech input. Chrome or Edge can; Firefox can't.";
    case "insecure":
      return "Speech input needs a secure (https) connection.";
    case "no-permission":
      return "Microphone access was blocked. Allow it in the browser's site settings and try again.";
    case "no-speech":
      return "Didn't catch anything. Tap the mic and speak just after it turns pink.";
    case "no-mic":
      return "No microphone was found on this device.";
    case "network":
      return "Speech recognition needs a connection and couldn't reach it.";
    default:
      return "Speech input stopped unexpectedly. Try again, or type instead.";
  }
}

export interface DictationHandlers {
  /** Fires repeatedly while speaking, so the walker sees it working. */
  onInterim(text: string): void;
  /** Fires once with the settled transcript and its confidence. */
  onFinal(text: string, confidence: number): void;
  onError(error: DictationError): void;
  onEnd(): void;
}

export interface DictationSession {
  stop(): void;
  abort(): void;
}

/**
 * Single utterance, with interim results so the UI can show words appearing.
 * Continuous mode is deliberately off: one sentence, one action, matching how
 * the harness works.
 */
export function startDictation(handlers: DictationHandlers): DictationSession | null {
  const Ctor = ctor();
  if (!Ctor) {
    handlers.onError("not-supported");
    return null;
  }
  if (!isSecureForMic()) {
    handlers.onError("insecure");
    return null;
  }

  const rec = new Ctor();
  // Singapore English first; the browser falls back on its own if unavailable.
  rec.lang = "en-SG";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let settled = false;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const alt = r[0];
      if (r.isFinal) {
        settled = true;
        handlers.onFinal(alt.transcript.trim(), alt.confidence ?? 0);
      } else {
        interim += alt.transcript;
      }
    }
    if (interim) handlers.onInterim(interim.trim());
  };

  rec.onerror = (e) => {
    const map: Record<string, DictationError> = {
      "not-allowed": "no-permission",
      "service-not-allowed": "no-permission",
      "no-speech": "no-speech",
      "audio-capture": "no-mic",
      network: "network",
    };
    handlers.onError(map[e.error] ?? "unknown");
  };

  rec.onend = () => {
    if (!settled) handlers.onEnd();
    else handlers.onEnd();
  };

  try {
    rec.start();
  } catch {
    handlers.onError("unknown");
    return null;
  }

  return {
    stop: () => { try { rec.stop(); } catch { /* already stopped */ } },
    abort: () => { try { rec.abort(); } catch { /* already stopped */ } },
  };
}
