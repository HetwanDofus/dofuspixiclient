import { createLogger } from "@/utils/logger";

const log = createLogger("ClassesLang");

const LOCALE = "fr";
const BUNDLE_URL = `/assets/langs/${LOCALE}/classes.json`;

/**
 * Which spells belong to which breed, from the `classes` lang bundle
 * (`G[classId].s` — the breed's spell list in learn order).
 *
 * The spell book's "Type de sort" filter needs this: a character's
 * spell list mixes breed spells with spells granted by other means, and
 * "Classe" shows only the former. Nothing on the wire distinguishes
 * them — in Dofus 1.29 the client has always read this from the bundle.
 */
let byClass: Map<number, Set<number>> | null = null;
let loading: Promise<Map<number, Set<number>>> | null = null;
const listeners = new Set<() => void>();

function parseBundle(json: unknown): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
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
    const ids = new Set<number>();
    for (const value of raw.s) {
      if (typeof value === "number" && Number.isFinite(value)) {
        ids.add(value);
      }
    }
    out.set(classId, ids);
  }
  return out;
}

export function loadClassesLang(): Promise<Map<number, Set<number>>> {
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

function finish(): Map<number, Set<number>> {
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
  const ids = byClass?.get(classId);
  if (!ids) {
    return true;
  }
  return ids.has(spellId);
}
