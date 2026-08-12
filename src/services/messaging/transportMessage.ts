import type { Dog, TransportPlan, VanRoute } from "@/models/types";
import { formatLong } from "@/utils/dates";

/**
 * The van run sheet as a WhatsApp message.
 *
 * Written for a driver, which drives every decision here:
 *
 *  - One message PER VAN by default. A driver on Van 1 does not need Van 2's
 *    stops, and sending both is how someone ends up at the wrong address.
 *  - Arrival clock times, not just distances. "08:19" is actionable at the
 *    kerb; "6.2 km" is not.
 *  - The address gets its own line so it can be long-pressed and copied
 *    straight into a maps app.
 *  - Handling warnings sit with the stop they belong to, not in a footer
 *    nobody scrolls to.
 */

const COLOUR_DOT: Record<string, string> = { green: "🟢", yellow: "🟡", red: "🔴" };
const dot = (c: string | null | undefined) => (c ? COLOUR_DOT[c] ?? "⚪" : "⚪");

const RULE = "━━━━━━━━━━━━━━━";
const KEYCAPS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
/** Keycap emoji only exist to ten; past that a plain number is clearer than nothing. */
const stopMarker = (i: number) => KEYCAPS[i] ?? `*${i + 1}.*`;

const DEPART_HOUR = { pickup: 8, dropoff: 18 } as const;

function clockAt(mode: "pickup" | "dropoff", minutesFromBase: number): string {
  const d = new Date();
  d.setHours(DEPART_HOUR[mode], 0, 0, 0);
  d.setMinutes(d.getMinutes() + minutesFromBase);
  return d.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function fmtMins(total: number): string {
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export interface TransportMessageInput {
  date: string;
  mode: "pickup" | "dropoff";
  plan: TransportPlan;
  dogs: Map<string, Dog>;
  facilityName: string;
  live: boolean;
  /** Omit for a combined sheet covering every van. */
  vanIndex?: number;
}

export function buildTransportMessage(input: TransportMessageInput): string {
  const { date, mode, plan, dogs, facilityName, live, vanIndex } = input;
  const vans = vanIndex === undefined
    ? plan.vans.filter((v) => v.stops.length)
    : plan.vans.filter((v) => v.vanIndex === vanIndex);

  const label = mode === "pickup" ? "MORNING PICKUP" : "EVENING DROP-OFF";
  const lines: string[] = [];

  lines.push(
    vanIndex === undefined
      ? `🚐 *${facilityName.toUpperCase()} — ${label}*`
      : `🚐 *${facilityName.toUpperCase()} — VAN ${vanIndex + 1}*`
  );
  lines.push(`📅 ${formatLong(date)}${vanIndex === undefined ? "" : ` · ${label.toLowerCase()}`}`);

  if (!vans.length) {
    lines.push("");
    lines.push(`_No ${mode === "pickup" ? "pickups" : "drop-offs"} on this date._`);
    return lines.join("\n");
  }

  for (const van of vans) {
    const dogCount = van.stops.reduce((n, s) => n + s.dogIds.length, 0);
    lines.push("");
    lines.push(RULE);
    lines.push("");

    if (vanIndex === undefined) lines.push(`🚐 *VAN ${van.vanIndex + 1}*`);
    lines.push(
      `🕗 Leaves base ${clockAt(mode, 0)} · ${van.stops.length} stop${van.stops.length === 1 ? "" : "s"} · ` +
        `${dogCount} dog${dogCount === 1 ? "" : "s"} · ${van.distanceKm.toFixed(1)} km` +
        (van.durationMinutes ? ` · ${fmtMins(van.durationMinutes)}` : "")
    );
    lines.push("");

    van.stops.forEach((stop, i) => {
      const members = stop.dogIds.map((id) => dogs.get(id)).filter((d): d is Dog => !!d);
      const eta = stop.etaMinutes !== undefined ? `  ${clockAt(mode, stop.etaMinutes)}` : "";

      lines.push(`${stopMarker(i)}${eta}`);
      lines.push(`🐕 ${members.map((m) => `${dot(m.behaviorColor)} ${m.name}`).join("   ")}`);
      lines.push(`📍 ${stop.address}`);
      if (stop.ownerNames.length) lines.push(`👤 ${stop.ownerNames.join(", ")}`);

      // Warnings belong with the stop, not in a footer nobody scrolls to.
      for (const r of stop.reasons.filter((x) => x.severity !== "info")) {
        lines.push(`⚠️ ${r.message}`);
      }
      // Handling notes that only matter in a vehicle.
      for (const m of members) {
        if (m.behaviorColor === "red") lines.push(`🔴 ${m.name} — Red, handle per policy`);
        const crate = m.constraints?.find((c) => c.type === "crate_required");
        if (crate) lines.push(`📦 ${m.name} — crate required`);
      }
      lines.push("");
    });

    const back = van.durationMinutes ? clockAt(mode, van.durationMinutes) : null;
    if (back) lines.push(`🏁 Back at base ~${back}`);
  }

  if (plan.needsReview.length) {
    lines.push("");
    lines.push(RULE);
    lines.push("");
    lines.push(`⚠️ *NOT ON A VAN* (${plan.needsReview.length})`);
    for (const r of plan.needsReview) {
      const d = dogs.get(r.dogId);
      lines.push(`• ${dot(d?.behaviorColor)} ${d?.name ?? r.dogId}`);
    }
  }

  lines.push("");
  lines.push(RULE);
  lines.push(
    live
      ? "_Times are traffic-aware estimates, not guarantees._"
      : "_Times are rough estimates — live routing is off._"
  );

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
