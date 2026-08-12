/**
 * Speech recognition is trained on general English, and this roster is not:
 * Kiara, Comel, Haziq, Nala, Espresso, Caramel. Dictation reliably mangles
 * exactly the words that matter most, because a dog's name is the one token
 * the harness must resolve to act at all.
 *
 * So after transcription, tokens are snapped back to real roster names before
 * the sentence reaches the interpreter. Corrections are shown, never silent —
 * a walker needs to see that "Kiora" became "Kiara" so they can catch it when
 * it guesses wrong.
 */

/**
 * Words that appear in commands and must never be rewritten into a dog name.
 * Without this, "van" could snap to "Nala" and quietly change the meaning.
 */
const PROTECTED = new Set([
  "the", "and", "a", "an", "to", "on", "in", "at", "of", "for", "with", "from",
  "is", "isn't", "not", "no", "cannot", "can't", "must", "should", "shouldn't",
  "be", "been", "get", "gets", "got", "go", "goes", "put", "move", "moved",
  "take", "takes", "change", "set", "mark", "make", "add", "remove", "swap",
  "van", "vans", "floor", "floors", "room", "rooms", "walk", "walks", "group",
  "groups", "daycare", "today", "tomorrow", "week", "next", "this", "last",
  "morning", "evening", "pickup", "pick", "up", "dropoff", "drop", "off",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "green", "yellow", "red", "colour", "color", "behaviour", "behavior",
  "along", "together", "apart", "keep", "needs", "need", "meds", "medication",
  "coming", "attending", "absent", "away", "out", "going", "forward",
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "he", "she", "they", "it", "his", "her", "their", "them", "him",
]);

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Distance budget scales with word length; short words get almost none. */
function budget(len: number): number {
  if (len <= 3) return 0;
  if (len <= 5) return 1;
  return 2;
}

export interface SnapCorrection {
  from: string;
  to: string;
}

export interface SnapResult {
  text: string;
  corrections: SnapCorrection[];
}

/**
 * @param text   raw transcript
 * @param names  every name the interpreter can resolve — dogs and walkers
 */
export function snapToRoster(text: string, names: string[]): SnapResult {
  if (!text.trim() || !names.length) return { text, corrections: [] };

  const exact = new Set(names.map((n) => n.toLowerCase()));
  const corrections: SnapCorrection[] = [];

  // Split on whitespace but keep punctuation attached so it can be restored.
  const out = text.split(/(\s+)/).map((chunk) => {
    if (/^\s+$/.test(chunk) || !chunk) return chunk;

    const lead = chunk.match(/^[^\p{L}]*/u)?.[0] ?? "";
    const tail = chunk.match(/[^\p{L}]*$/u)?.[0] ?? "";
    const word = chunk.slice(lead.length, chunk.length - tail.length);
    const lower = word.toLowerCase();

    if (!word || word.length < 3) return chunk;
    if (PROTECTED.has(lower)) return chunk;
    if (exact.has(lower)) return chunk;

    let best: { name: string; d: number } | null = null;
    let runnerUp = Infinity;

    for (const name of names) {
      const d = levenshtein(lower, name.toLowerCase());
      if (!best || d < best.d) {
        runnerUp = best?.d ?? Infinity;
        best = { name, d };
      } else if (d < runnerUp) {
        runnerUp = d;
      }
    }

    if (!best) return chunk;
    if (best.d > budget(Math.max(word.length, best.name.length))) return chunk;
    // Ambiguous match: two roster names are equally close, so don't guess.
    if (runnerUp === best.d) return chunk;

    corrections.push({ from: word, to: best.name });
    return `${lead}${best.name}${tail}`;
  });

  return { text: out.join(""), corrections };
}
