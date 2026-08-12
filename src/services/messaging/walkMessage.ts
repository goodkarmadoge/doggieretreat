import type { BehaviorColor, Dog, WalkPlan, Walker } from "@/models/types";
import { formatLong } from "@/utils/dates";

/**
 * The walk plan as a WhatsApp message.
 *
 * This is the artefact that actually reaches the walkers — the app is the
 * system of record, but WhatsApp is where the day gets coordinated. So the
 * output is written for that surface rather than being a debug dump:
 *
 *  - *single asterisks* are WhatsApp's bold syntax, so headers render as bold
 *    rather than showing literal punctuation
 *  - a coloured circle carries the behaviour rating, which survives being
 *    read one-handed on a phone in daylight far better than a text label
 *  - blank lines separate walkers, because WhatsApp collapses dense text into
 *    an unreadable wall
 *  - no table alignment: proportional fonts destroy it on mobile
 */

const COLOUR_DOT: Record<BehaviorColor, string> = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

const dot = (c: BehaviorColor | null) => (c ? COLOUR_DOT[c] : "⚪");

const RULE = "━━━━━━━━━━━━━━━";

export interface WalkMessageInput {
  date: string;
  plan: WalkPlan;
  dogs: Map<string, Dog>;
  walkers: Walker[];
  facilityName: string;
  maxPerWalker: number;
}

export function buildWalkMessage(input: WalkMessageInput): string {
  const { date, plan, dogs, walkers, facilityName, maxPerWalker } = input;
  const dog = (id: string) => dogs.get(id);
  const walkerName = (id: string | null) =>
    walkers.find((w) => w.id === id)?.name ?? "Unassigned";

  const lines: string[] = [];

  lines.push(`🐕 *${facilityName.toUpperCase()} — WALK PLAN*`);
  lines.push(`📅 ${formatLong(date)}`);
  lines.push("");
  lines.push(RULE);
  lines.push("");

  if (!plan.groups.length) {
    lines.push("_No walk groups for this date._");
  }

  for (const group of plan.groups) {
    const members = group.dogIds.map(dog).filter((d): d is Dog => !!d);
    const solo = members.length === 1 && members[0].behaviorColor === "red";

    lines.push(
      `👤 *${walkerName(group.walkerId)}*  (${members.length}/${maxPerWalker})` +
        (solo ? "  —  1:1" : "")
    );
    for (const m of members) {
      lines.push(`${dot(m.behaviorColor)} ${m.name}`);
    }

    // Only surface real problems; the routine "this group is fine" reasoning
    // is noise in a message someone reads at a kerbside.
    const problems = group.reasons.filter((r) => r.severity !== "info");
    for (const p of problems) {
      lines.push(`   ⚠️ ${p.message}`);
    }
    lines.push("");
  }

  if (plan.excused.length) {
    lines.push(RULE);
    lines.push("");
    lines.push(`🚫 *NOT WALKING* (${plan.excused.length})`);
    for (const e of plan.excused) {
      const d = dog(e.dogId);
      const why = trimReason(e.reasons[0]?.message ?? "", d?.name);
      lines.push(`• ${d?.name ?? e.dogId}${why ? ` (${why})` : ""}`);
    }
    lines.push("");
  }

  if (plan.unassigned.length) {
    lines.push(RULE);
    lines.push("");
    lines.push(`⚠️ *NEEDS A DECISION* (${plan.unassigned.length})`);
    for (const u of plan.unassigned) {
      const d = dog(u.dogId);
      const why = trimReason(u.reasons[0]?.message ?? "", d?.name);
      lines.push(`• ${dot(d?.behaviorColor ?? null)} ${d?.name ?? u.dogId}${why ? ` (${why})` : ""}`);
    }
    lines.push("");
  }

  if (plan.capacityNote) {
    lines.push(`ℹ️ ${plan.capacityNote}`);
    lines.push("");
  }

  lines.push(RULE);

  const walking = plan.groups.reduce((n, g) => n + g.dogIds.length, 0);
  lines.push(
    `${walking} walking · ${plan.excused.length} excused · ${plan.unassigned.length} to sort`
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Reasons are written for the dashboard, where there is room to explain and
 * the dog's name has to be repeated for context. In a chat message the line
 * already names the dog, so "Simba — Simba has no behaviour colour" reads
 * badly; the leading name is stripped and the clause set in parentheses,
 * which also avoids colliding with dashes inside the reason itself.
 */
function trimReason(text: string, dogName?: string): string {
  let first = text.split(/[.;]/)[0].trim();

  if (dogName) {
    const escaped = dogName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    first = first.replace(new RegExp(`^${escaped}('s)?\\s+`, "i"), "");
  }

  // Lowercase a plain opening word so the parenthetical reads as a phrase,
  // while leaving proper nouns and acronyms alone.
  if (/^[A-Z][a-z]/.test(first) && !/^[A-Z][a-z]+\s+(and|is|has)\b/.test(first)) {
    first = first[0].toLowerCase() + first.slice(1);
  }

  return first.length > 76 ? `${first.slice(0, 73)}…` : first;
}
