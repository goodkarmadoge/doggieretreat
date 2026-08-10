import Papa from "papaparse";
import type { Dog } from "@/models/types";

/**
 * Collar CSV import.
 *
 * Two rules matter more than the parsing:
 *
 *  1. Column names are NOT assumed. Headers are matched heuristically and every
 *     guess is editable before import.
 *
 *  2. Reimport must never destroy enriched data. Collar owns the basic fields;
 *     this application owns behaviour, compatibility, scheduling, transport and
 *     constraints. On a match, Collar fields refresh and enriched fields are
 *     carried across untouched.
 */

export type MappableField =
  | "collarId"
  | "collarOwnerId"
  | "name"
  | "ownerName"
  | "breed"
  | "address"
  | "vaccinationStatus"
  | "age"
  | "weightKg"
  | "notes";

export const FIELD_LABELS: Record<MappableField, string> = {
  collarId: "Collar Pet ID",
  collarOwnerId: "Collar Owner ID",
  name: "Dog name",
  ownerName: "Owner name",
  breed: "Breed",
  address: "Address",
  vaccinationStatus: "Vaccination status",
  age: "Age",
  weightKg: "Weight (kg)",
  notes: "Notes",
};

export const REQUIRED_FIELDS: MappableField[] = ["name"];

/** Header synonyms, checked as normalized substrings. */
const HINTS: Record<MappableField, string[]> = {
  collarId: ["petid", "collarid", "animalid", "dogid", "petnumber", "petref"],
  collarOwnerId: ["ownerid", "customerid", "clientid", "accountid"],
  name: ["petname", "dogname", "name", "animalname"],
  ownerName: ["ownername", "owner", "customer", "client", "guardian", "parent"],
  breed: ["breed", "type"],
  address: ["address", "petaddress", "homeaddress", "location", "street"],
  vaccinationStatus: ["vaccination", "vaccine", "vax", "immunisation", "immunization"],
  age: ["age", "years"],
  weightKg: ["weight", "kg", "mass"],
  notes: ["notes", "note", "comment", "remarks", "description"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  const headers = result.meta.fields ?? [];
  const rows = (result.data ?? []).filter((r) =>
    Object.values(r).some((v) => v && String(v).trim())
  );
  return { headers, rows };
}

export type Mapping = Partial<Record<MappableField, string>>;

/** Best-effort header matching. Every result is editable by staff. */
export function suggestMapping(headers: string[]): Mapping {
  const mapping: Mapping = {};
  const used = new Set<string>();

  (Object.keys(HINTS) as MappableField[]).forEach((field) => {
    const hints = HINTS[field];

    // Exact normalized match wins.
    let hit = headers.find(
      (h) => !used.has(h) && hints.some((x) => norm(h) === x)
    );
    // Then substring.
    if (!hit) {
      hit = headers.find(
        (h) => !used.has(h) && hints.some((x) => norm(h).includes(x))
      );
    }
    if (hit) {
      mapping[field] = hit;
      used.add(hit);
    }
  });

  return mapping;
}

export interface ImportRowPlan {
  rowIndex: number;
  incoming: Partial<Dog>;
  matchedDogId?: string;
  matchedBy?: "collarId" | "ownerId+name" | "name+owner";
  outcome: "new" | "updated" | "unchanged" | "duplicate";
  duplicateOf?: string;
  changedFields: string[];
}

export interface ImportPlan {
  rows: ImportRowPlan[];
  counts: { new: number; updated: number; unchanged: number; duplicate: number };
}

const cleanName = (s?: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Three-tier matching. Collar Pet ID is authoritative; owner id + dog name is
 * the stable fallback; name + owner name is last resort because both can change.
 */
export function planImport(
  parsed: ParsedCsv,
  mapping: Mapping,
  existing: Dog[]
): ImportPlan {
  const byCollarId = new Map<string, Dog>();
  const byOwnerIdName = new Map<string, Dog>();
  const byNameOwner = new Map<string, Dog>();

  for (const d of existing) {
    if (d.collarId) byCollarId.set(d.collarId.trim(), d);
    if (d.collarOwnerId) {
      byOwnerIdName.set(`${d.collarOwnerId.trim()}|${cleanName(d.name)}`, d);
    }
    byNameOwner.set(`${cleanName(d.name)}|${cleanName(d.ownerName)}`, d);
  }

  const seenIncoming = new Map<string, number>();
  const rows: ImportRowPlan[] = [];
  const counts = { new: 0, updated: 0, unchanged: 0, duplicate: 0 };

  parsed.rows.forEach((raw, rowIndex) => {
    const get = (f: MappableField) => {
      const col = mapping[f];
      if (!col) return undefined;
      const v = raw[col];
      return v === undefined || v === null || String(v).trim() === ""
        ? undefined
        : String(v).trim();
    };

    const name = get("name");
    if (!name) return;

    const incoming: Partial<Dog> = {
      collarId: get("collarId"),
      collarOwnerId: get("collarOwnerId"),
      name,
      ownerName: get("ownerName"),
      breed: get("breed"),
      address: get("address"),
      vaccinationStatus: get("vaccinationStatus"),
      personalityNotes: get("notes"),
    };

    const ageRaw = get("age");
    if (ageRaw && !Number.isNaN(Number(ageRaw))) incoming.age = Number(ageRaw);
    const wRaw = get("weightKg");
    if (wRaw && !Number.isNaN(Number(wRaw))) incoming.weightKg = Number(wRaw);

    // Duplicate rows inside the uploaded file itself.
    const dupKey = incoming.collarId
      ? `id:${incoming.collarId}`
      : `no:${cleanName(name)}|${cleanName(incoming.ownerName)}`;
    if (seenIncoming.has(dupKey)) {
      rows.push({
        rowIndex,
        incoming,
        outcome: "duplicate",
        duplicateOf: `row ${seenIncoming.get(dupKey)! + 1}`,
        changedFields: [],
      });
      counts.duplicate++;
      return;
    }
    seenIncoming.set(dupKey, rowIndex);

    let match: Dog | undefined;
    let matchedBy: ImportRowPlan["matchedBy"];

    if (incoming.collarId && byCollarId.has(incoming.collarId)) {
      match = byCollarId.get(incoming.collarId);
      matchedBy = "collarId";
    }
    if (!match && incoming.collarOwnerId) {
      const k = `${incoming.collarOwnerId}|${cleanName(name)}`;
      if (byOwnerIdName.has(k)) {
        match = byOwnerIdName.get(k);
        matchedBy = "ownerId+name";
      }
    }
    if (!match) {
      const k = `${cleanName(name)}|${cleanName(incoming.ownerName)}`;
      if (byNameOwner.has(k)) {
        match = byNameOwner.get(k);
        matchedBy = "name+owner";
      }
    }

    if (!match) {
      rows.push({ rowIndex, incoming, outcome: "new", changedFields: [] });
      counts.new++;
      return;
    }

    const changed: string[] = [];
    (["name", "ownerName", "breed", "address", "vaccinationStatus", "age", "weightKg"] as const)
      .forEach((f) => {
        const next = incoming[f];
        if (next !== undefined && next !== (match as Dog)[f]) changed.push(f);
      });

    rows.push({
      rowIndex,
      incoming,
      matchedDogId: match.id,
      matchedBy,
      outcome: changed.length ? "updated" : "unchanged",
      changedFields: changed,
    });
    if (changed.length) counts.updated++;
    else counts.unchanged++;
  });

  return { rows, counts };
}

/**
 * Fields this application owns. They survive every reimport — Collar has no
 * opinion about them and must never blank them.
 */
const ENRICHED_KEYS = [
  "behaviorColor",
  "operationalNotes",
  "incompatibleDogIds",
  "conflictsReviewed",
  "constraints",
  "defaultPickup",
  "defaultDropoff",
  "active",
] as const;

export function materialise(plan: ImportPlan, existing: Dog[]): Dog[] {
  const byId = new Map(existing.map((d) => [d.id, d]));
  const out: Dog[] = [];

  for (const row of plan.rows) {
    if (row.outcome === "duplicate") continue;

    if (row.outcome === "new") {
      const id =
        row.incoming.collarId ??
        `imported-${cleanName(row.incoming.name).replace(/\s/g, "-")}-${row.rowIndex}`;
      out.push({
        id,
        collarId: row.incoming.collarId,
        collarOwnerId: row.incoming.collarOwnerId,
        name: row.incoming.name!,
        ownerName: row.incoming.ownerName,
        breed: row.incoming.breed,
        age: row.incoming.age,
        weightKg: row.incoming.weightKg,
        address: row.incoming.address,
        vaccinationStatus: row.incoming.vaccinationStatus,
        personalityNotes: row.incoming.personalityNotes,
        operationalNotes: "",
        behaviorColor: null,
        incompatibleDogIds: [],
        conflictsReviewed: false,
        constraints: [],
        defaultPickup: null,
        defaultDropoff: null,
        active: true,
        isDemo: false,
      });
      continue;
    }

    const current = byId.get(row.matchedDogId!);
    if (!current) continue;

    const merged: Dog = { ...current };
    const writable = merged as unknown as Record<string, unknown>;
    const source = current as unknown as Record<string, unknown>;

    // Collar-owned fields refresh...
    (["collarId", "collarOwnerId", "name", "ownerName", "breed", "address",
      "vaccinationStatus", "age", "weightKg", "personalityNotes"] as const)
      .forEach((f) => {
        const v = row.incoming[f];
        if (v !== undefined) writable[f] = v;
      });
    // ...enriched fields are carried across untouched.
    ENRICHED_KEYS.forEach((k) => {
      writable[k] = source[k];
    });

    out.push(merged);
  }

  return out;
}
