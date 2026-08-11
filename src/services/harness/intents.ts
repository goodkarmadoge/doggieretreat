import type { Dog } from "@/models/types";

/**
 * Intent taxonomy — AI Harness Spec §7.
 *
 * This is the complete allow-list of actions the interpreter may ever emit.
 * It is deliberately small. It grows by an explicit code change here, never
 * from whatever a caretaker happens to type (§13, "intent taxonomy creep").
 */

export type IntentName =
  | "flag_incompatibility"
  | "remove_incompatibility"
  | "reschedule_service"
  | "reassign_walk_group"
  | "reassign_room"
  | "reassign_van"
  | "mark_absent"
  | "mark_present"
  | "flag_medical_note"
  | "set_behaviour_colour";

/** §7 risk tiers. */
export type RiskTier = "auto_apply" | "confirm" | "admin_only";

/**
 * §3 — two datasets, not one. Working-dataset edits are disposable and can be
 * regenerated; master edits are standing facts and would sync back to Collar.
 */
export type ChangeScope = "working_dataset" | "master_db";

/** §8 permission model. */
export type StaffRole = "caretaker" | "shift_lead" | "admin";

export const ROLE_RANK: Record<StaffRole, number> = {
  caretaker: 1,
  shift_lead: 2,
  admin: 3,
};

export const ROLE_LABEL: Record<StaffRole, string> = {
  caretaker: "Caretaker / dog walker",
  shift_lead: "Senior caretaker / shift lead",
  admin: "Admin / ops manager",
};

export interface IntentDef {
  name: IntentName;
  /** Plain-English label used in confirmation cards. */
  label: string;
  risk: RiskTier;
  scope: ChangeScope;
  /** Minimum role permitted to APPLY this action (§8). */
  minRole: StaffRole;
  /** Shown to staff so the tier is never a mystery. */
  rationale: string;
}

export const INTENTS: Record<IntentName, IntentDef> = {
  flag_incompatibility: {
    name: "flag_incompatibility",
    label: "Flag dogs as incompatible",
    risk: "confirm",
    scope: "master_db",
    minRole: "shift_lead",
    rationale:
      "Safety-relevant and applies to every future grouping, so it is never auto-applied regardless of confidence.",
  },
  remove_incompatibility: {
    name: "remove_incompatibility",
    label: "Remove an incompatibility",
    risk: "admin_only",
    scope: "master_db",
    minRole: "admin",
    rationale:
      "Removing a safety flag can put two dogs back together. Admin only.",
  },
  reschedule_service: {
    name: "reschedule_service",
    label: "Reschedule daycare",
    risk: "confirm",
    scope: "working_dataset",
    minRole: "shift_lead",
    rationale:
      "Affects attendance, transport and billing. A recurring change also writes to the master record.",
  },
  reassign_walk_group: {
    name: "reassign_walk_group",
    label: "Move a dog to another walker",
    risk: "auto_apply",
    scope: "working_dataset",
    minRole: "caretaker",
    rationale: "Today only and trivially reversible, so it applies immediately with undo.",
  },
  reassign_room: {
    name: "reassign_room",
    label: "Move a dog to another floor",
    risk: "auto_apply",
    scope: "working_dataset",
    minRole: "caretaker",
    rationale: "Today only and trivially reversible, so it applies immediately with undo.",
  },
  reassign_van: {
    name: "reassign_van",
    label: "Move a dog to another van",
    risk: "confirm",
    scope: "working_dataset",
    minRole: "caretaker",
    rationale:
      "Dogs are confined together for a whole run, so a van change is confirmed even though it is same-day.",
  },
  mark_absent: {
    name: "mark_absent",
    label: "Mark a dog absent",
    risk: "auto_apply",
    scope: "working_dataset",
    minRole: "caretaker",
    rationale: "Attendance for one date, reversible with undo.",
  },
  mark_present: {
    name: "mark_present",
    label: "Mark a dog attending",
    risk: "auto_apply",
    scope: "working_dataset",
    minRole: "caretaker",
    rationale: "Attendance for one date, reversible with undo.",
  },
  flag_medical_note: {
    name: "flag_medical_note",
    label: "Add a medical note",
    risk: "admin_only",
    scope: "master_db",
    minRole: "admin",
    rationale:
      "Medical information is never auto-applied. It always routes to a person for review.",
  },
  set_behaviour_colour: {
    name: "set_behaviour_colour",
    label: "Set behaviour colour",
    risk: "confirm",
    scope: "master_db",
    minRole: "shift_lead",
    rationale:
      "Extension beyond the spec's taxonomy. Colour drives walk and floor grouping, so it is treated as safety-relevant.",
  },
};

/**
 * §7 — below this, the harness does not even show a confirm prompt. It routes
 * to NEEDS_HUMAN_REVIEW. The safe default is "ask a person", not "guess".
 */
export const CONFIDENCE_THRESHOLD = 0.6;

/** A structured action. Mirrors the tool schema in §7. */
export interface HarnessAction {
  intent: IntentName;
  /** Extracted parameters, per-intent. */
  params: Record<string, unknown>;
  /** 0–1. Interpretation confidence. */
  confidence: number;
  /** Original free text, unmodified (§7 — required in every schema). */
  source_text: string;
  /** Dogs the action touches, for the confirmation card and audit. */
  dogIds: string[];
  /** Plain-English preview shown before applying (§5 Stage 4). */
  preview: string;
  /** Extra lines of consequence shown under the preview. */
  detail: string[];
  effectiveDate?: string;
  /** Set when the change should also update the standing record. */
  recurring: boolean;
}

export type ReviewReason =
  | "low_confidence"
  | "no_matching_intent"
  | "insufficient_permission"
  | "validation_failed"
  | "ambiguous_dog";

export interface ReviewItem {
  id: string;
  createdAt: string;
  /** Original free text, always preserved (§6 Layer 6). */
  sourceText: string;
  reason: ReviewReason;
  /** Human-readable explanation of why this needs a person. */
  message: string;
  intent?: IntentName;
  confidence?: number;
  contextDate: string;
  submittedByRole: StaffRole;
  resolved: boolean;
}

export interface AmbiguityPrompt {
  token: string;
  candidates: Dog[];
}
