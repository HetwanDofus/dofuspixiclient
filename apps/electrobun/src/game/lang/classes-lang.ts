import { createLogger } from "@/utils/logger";

const log = createLogger("ClassesLang");

const LOCALE = "fr";
const BUNDLE_URL = `/assets/langs/${LOCALE}/classes.json`;

/**
 * Which spells belong to which breed, from the `classes` lang bundle
 * (`G[classId].s`), each mapped to its index in that list.
 *
 * The spell book's "Type de sort" filter needs the membership: a
 * character's spell list mixes breed spells with spells granted by
 * other means, and "Classe" shows only the former. Nothing on the wire
 * distinguishes them — in Dofus 1.29 the client has always read this
 * from the bundle.
 *
 * The *index* is kept because the bundle's order is the tie-break the
 * book sorts on. `s` is not itself in learn order (a Féca's three
 * starters sit at the end of its array), so ordering the book means
 * learn level first, this index second — the same rule migration 0048
 * used to number `class_spells.position`.
 */
let byClass: Map<number, Map<number, number>> | null = null;
let loading: Promise<Map<number, Map<number, number>>> | null = null;
const listeners = new Set<() => void>();

function parseBundle(json: unknown): Map<number, Map<number, number>> {
  const out = new Map<number, Map<number, number>>();
  const data = (json as { data?: { G?: Record<string, { s?: unknown }> } }).data
    ?.G;
  if (!data) {
    return out;
  }
  for (const [key, raw] of Object.entries(data)) {
    const classId = Number.parseInt(key, 10);
    if (!Number.isFinite(classId) || !Array.isArray(raw?.s)) {
      continue;
    }
    const ranks = new Map<number, number>();
    for (const value of raw.s) {
      if (typeof value === "number" && Number.isFinite(value)) {
        // First occurrence wins; a duplicated id keeps its earliest rank.
        if (!ranks.has(value)) {
          ranks.set(value, ranks.size);
        }
      }
    }
    out.set(classId, ranks);
  }
  return out;
}

export function loadClassesLang(): Promise<Map<number, Map<number, number>>> {
  if (byClass) {
    return Promise.resolve(byClass);
  }
  if (!loading) {
    loading = fetch(BUNDLE_URL)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((json) => {
        byClass = parseBundle(json);
        return finish();
      })
      .catch((err) => {
        log.error("failed to load classes lang bundle:", err);
        // Latch empty: the filter then treats every spell as a class
        // spell, which is what an unfiltered list looks like anyway.
        byClass = new Map();
        return finish();
      });
  }
  return loading;
}

function finish(): Map<number, Map<number, number>> {
  for (const cb of listeners) {
    cb();
  }
  return byClass ?? new Map();
}

export function subscribeClassesLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * True when `spellId` is one of `classId`'s breed spells. Returns true
 * for every spell until the bundle lands, so the default "Classe" view
 * is never briefly empty on open.
 */
export function isClassSpell(classId: number, spellId: number): boolean {
  const ranks = byClass?.get(classId);
  if (!ranks) {
    return true;
  }
  return ranks.has(spellId);
}

/**
 * Where `spellId` sits in `classId`'s bundle list — the spell book's
 * tie-break between two spells learned at the same level. Anything the
 * bundle does not list (or every spell, before it loads) sorts last,
 * where an unordered spell belongs.
 */
export function classSpellRank(classId: number, spellId: number): number {
  return byClass?.get(classId)?.get(spellId) ?? Number.POSITIVE_INFINITY;
}
