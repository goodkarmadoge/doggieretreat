import type { Dog, Floor } from "@/models/types";
import { areIncompatible } from "@/services/compatibility/compatibility";
import type { HarnessAction } from "./intents";
import type { HarnessContext } from "./interpreter";

/**
 * Stage 3 — Validate (AI Harness Spec §5, §6 Layer 3).
 *
 * Plain code. No model call. This layer does not trust the interpreter's output
 * any more than it would trust a raw API request from any other client, so even
 * a wrong or manipulated interpretation cannot bypass capacity limits, identity
 * checks or safety rules.
 */

export interface ValidationResult {
  ok: boolean;
  /** Blocking problems. Any of these stops the action. */
  errors: string[];
  /** Non-blocking things the person confirming should see. */
  warnings: string[];
}

const ok = (warnings: string[] = []): ValidationResult => ({ ok: true, errors: [], warnings });

export function validateAction(
  action: HarnessAction,
  ctx: HarnessContext
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(ctx.dogs.map((d) => [d.id, d]));

  // Every referenced dog must exist and be active — identity is checked here,
  // not taken on the interpreter's word.
  for (const id of action.dogIds) {
    const dog = byId.get(id);
    if (!dog) {
      errors.push(`Dog record ${id} no longer exists.`);
      continue;
    }
    if (!dog.active) errors.push(`${dog.name} is deactivated and cannot be scheduled.`);
  }
  if (errors.length) return { ok: false, errors, warnings };

  switch (action.intent) {
    case "flag_incompatibility": {
      const primary = byId.get(String(action.params.primary_dog_id))!;
      const others = (action.params.incompatible_with_dog_ids as string[]) ?? [];

      // Typo guard from §9 Example A — a dog flagged against itself.
      if (others.includes(primary.id)) {
        errors.push(`${primary.name} cannot be flagged against themselves.`);
      }
      const already = others.filter((id) => {
        const o = byId.get(id);
        return o && areIncompatible(primary, o);
      });
      if (already.length === others.length && others.length > 0) {
        errors.push(
          `${primary.name} is already flagged against ${already.map((id) => byId.get(id)?.name).join(", ")}. Nothing to change.`
        );
      } else if (already.length) {
        warnings.push(
          `Already on file: ${already.map((id) => byId.get(id)?.name).join(", ")}. Only the new pairs will be added.`
        );
      }
      // Two dogs at one address cannot actually be separated at home.
      for (const id of others) {
        const o = byId.get(id);
        if (o && o.address && primary.address && o.address === primary.address) {
          warnings.push(
            `${primary.name} and ${o.name} live at the same address, so they cannot be separated for transport. They will still be split on walks and floors.`
          );
        }
      }
      break;
    }

    case "remove_incompatibility": {
      const a = byId.get(String(action.params.dogAId))!;
      const b = byId.get(String(action.params.dogBId))!;
      if (!areIncompatible(a, b)) {
        errors.push(`${a.name} and ${b.name} are not currently flagged as incompatible.`);
      }
      break;
    }

    case "reassign_van": {
      const dog = byId.get(String(action.params.dogId))!;
      const vanIndex = Number(action.params.vanIndex);
      if (!Number.isInteger(vanIndex) || vanIndex < 0 || vanIndex >= ctx.vanCount) {
        errors.push(`Van ${vanIndex + 1} does not exist.`);
        break;
      }
      if (dog.behaviorColor === null) {
        warnings.push(`${dog.name} has no behaviour colour recorded, so van sharing cannot be judged safe.`);
      }
      if (!dog.defaultPickup && !dog.defaultDropoff) {
        warnings.push(`${dog.name} has no transport requirement, so they may not appear on a run.`);
      }
      break;
    }

    case "reassign_room": {
      const dog = byId.get(String(action.params.dogId))!;
      const floor = ctx.floors.find((f) => f.id === action.params.floorId);
      if (!floor) {
        errors.push("That floor no longer exists.");
        break;
      }
      if (dog.behaviorColor === "red") {
        warnings.push(
          `${dog.name} is Red. Doggie Retreat's floor rules for Red dogs are not configured, so this placement is a staff decision.`
        );
      }
      break;
    }

    case "reassign_walk_group": {
      const walker = ctx.walkers.find((w) => w.id === action.params.walkerId);
      const dog = byId.get(String(action.params.dogId))!;
      if (!walker) {
        errors.push("That walker is no longer on the roster.");
        break;
      }
      if (!walker.available) errors.push(`${walker.name} is marked unavailable today.`);
      if (dog.behaviorColor === "red" ) {
        warnings.push(`${dog.name} is Red and walks 1:1, so this group will hold only them.`);
      }
      break;
    }

    case "reschedule_service": {
      const toWeekday = action.params.toWeekday as string | undefined;
      if (!toWeekday) errors.push("No target day was identified.");
      if (action.params.fromWeekday && action.params.fromWeekday === toWeekday) {
        errors.push("The dog already attends that day.");
      }
      break;
    }

    case "mark_absent":
    case "mark_present": {
      const date = String(action.params.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("Could not work out which date was meant.");
      break;
    }

    case "flag_medical_note": {
      const note = String(action.params.note ?? "").trim();
      if (note.length < 3) errors.push("The medical note is too short to record.");
      warnings.push("Medical notes are reviewed by an admin before they are recorded.");
      break;
    }

    case "set_behaviour_colour": {
      const dog = byId.get(String(action.params.dogId))!;
      const colour = action.params.colour;
      if (dog.behaviorColor === colour) {
        errors.push(`${dog.name} is already ${colour}.`);
      }
      if (colour === "red" && dog.incompatibleDogIds.length === 0 && !dog.conflictsReviewed) {
        warnings.push(`Nobody has checked ${dog.name}'s conflicts yet. Worth doing alongside this.`);
      }
      break;
    }
  }

  return errors.length ? { ok: false, errors, warnings } : ok(warnings);
}

/** Exposed for the floor validator reuse. */
export type { Floor, Dog };
