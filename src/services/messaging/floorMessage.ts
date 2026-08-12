import type { BehaviorColor, Dog, Floor, FloorPlan } from "@/models/types";
import { formatLong } from "@/utils/dates";

/**
 * The floor plan as a WhatsApp message.
 *
 * Written for floor staff, who are checking a roster rather than executing a
 * sequence — so dogs run inline rather than one per line. A 17-dog vertical
 * list is a wall of text nobody reads; three compact rows can be scanned at a
 * glance while holding a lead.
 *
 * Conflicts and unplaced dogs get their own blocks, because those are the two
 * things that actually need someone to do something.
 */

const COLOUR_DOT: Record<BehaviorColor, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const dot = (c: BehaviorColor | null) => (c ? COLOUR_DOT[c] : "⚪");

const RULE = "━━━━━━━━━━━━━━━";

export interface FloorMessageInput {
  date: string;
  plan: FloorPlan;
  floors: Floor[];
  dogs: Map<string, Dog>;
  facilityName: string;
}

export function buildFloorMessage(input: FloorMessageInput): string {
  const { date, plan, floors, dogs, facilityName } = input;
  const lines: string[] = [];

  lines.push(`🏠 *${facilityName.toUpperCase()} — FLOOR PLAN*`);
  lines.push(`📅 ${formatLong(date)}`);
  lines.push("");
  lines.push(RULE);

  const placed = plan.floors.reduce((n, f) => n + f.dogIds.length, 0);

  for (const assignment of plan.floors) {
    const floor = floors.find((f) => f.id === assignment.floorId);
    if (!floor) continue;
    const members = assignment.dogIds
      .map((id) => dogs.get(id))
      .filter((d): d is Dog => !!d);

    lines.push("");
    lines.push(`*${floor.name.toUpperCase()}*  ·  ${members.length}/${floor.capacity}`);

    if (!members.length) {
      lines.push("_empty_");
    } else {
      // Inline and wrapped: a roster is scanned, not worked through.
      lines.push(members.map((m) => `${dot(m.behaviorColor)} ${m.name}`).join("   "));
    }

    for (const r of assignment.reasons.filter((x) => x.severity !== "info")) {
      lines.push(`⚠️ ${r.message}`);
    }
  }

  if (plan.needsReview.length) {
    lines.push("");
    lines.push(RULE);
    lines.push("");
    lines.push(`⚠️ *NEEDS STAFF REVIEW* (${plan.needsReview.length})`);
    lines.push("_Not placed automatically — someone has to decide._");
    for (const r of plan.needsReview) {
      const d = dogs.get(r.dogId);
      const why = trimReason(r.reasons[0]?.message ?? "", d?.name);
      lines.push(`• ${dot(d?.behaviorColor ?? null)} ${d?.name ?? r.dogId}${why ? ` (${why})` : ""}`);
    }
  }

  lines.push("");
  lines.push(RULE);
  lines.push(`${placed} placed · ${plan.needsReview.length} to sort`);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Dashboard reasons repeat the dog's name; the line here already has it. */
function trimReason(text: string, dogName?: string): string {
  let first = text.split(/[.;]/)[0].trim();
  if (dogName) {
    const escaped = dogName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    first = first.replace(new RegExp(`^${escaped}('s)?\\s+`, "i"), "");
  }
  if (/^[A-Z][a-z]/.test(first) && !/^[A-Z][a-z]+\s+(and|is|has)\b/.test(first)) {
    first = first[0].toLowerCase() + first.slice(1);
  }
  return first.length > 76 ? `${first.slice(0, 73)}…` : first;
}
