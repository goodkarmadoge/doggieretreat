import type { Dog } from "@/models/types";

/**
 * An owner is just a name — there is no Owner entity. A HOUSEHOLD is identified
 * by normalized address, so several dogs at one address collapse into a single
 * van stop instead of one stop per dog.
 */
export function householdKey(address?: string): string {
  if (!address) return "unknown";
  return address
    .toLowerCase()
    .replace(/[#,.]/g, " ")
    .replace(/\bsingapore\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface Household {
  key: string;
  address: string;
  lat: number;
  lng: number;
  dogs: Dog[];
  ownerNames: string[];
}

export function groupIntoHouseholds(dogs: Dog[]): Household[] {
  const map = new Map<string, Household>();

  for (const dog of dogs) {
    const key = householdKey(dog.address);
    let h = map.get(key);
    if (!h) {
      h = {
        key,
        address: dog.address ?? "Address not recorded",
        lat: dog.lat ?? 0,
        lng: dog.lng ?? 0,
        dogs: [],
        ownerNames: [],
      };
      map.set(key, h);
    }
    h.dogs.push(dog);
    if (dog.ownerName && !h.ownerNames.includes(dog.ownerName)) {
      h.ownerNames.push(dog.ownerName);
    }
  }

  return [...map.values()];
}
