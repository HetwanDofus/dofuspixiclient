import { createLogger } from "@/utils/logger";

const log = createLogger("EffectsLang");

/**
 * Locale of the lang bundles the client fetches. The server resolves
 * spell names/descriptions itself (see gameserver `spells.service.ts`);
 * this is only for the effect-description templates, which never travel
 * on the wire — the effect payload carries ids and numbers, the client
 * renders the sentence. Same choice `map/handler.ts` makes for maps.
 */
const LOCALE = "fr";
const BUNDLE_URL = `/assets/langs/${LOCALE}/effects.json`;

/** Element an effect belongs to, from the bundle's `e` slot. */
export type EffectElement = "neutral" | "earth" | "fire" | "water" | "air";

const ELEMENT_BY_LETTER: Record<string, EffectElement> = {
  N: "neutral",
  E: "earth",
  F: "fire",
  W: "water",
  A: "air",
};

interface EffectTemplate {
  /** Description pattern, e.g. `Dommages : #1{~1~2 à }#2 (terre)`. */
  description: string;
  /** Characteristic id the effect boosts; 0 for effects with no stat. */
  characteristic: number;
  element: EffectElement | null;
  /** Display order (the bundle's `p`), higher first. Not independently
   * verified against a retail source beyond matching the one reference
   * capture's row order (800 → 124 → 983, i.e. 987 → 90 → −11); treat as
   * a working deduction, not a confirmed rule. */
  priority: number;
}

let templates: Map<number, EffectTemplate> | null = null;
let loading: Promise<Map<number, EffectTemplate>> | null = null;
const listeners = new Set<() => void>();

interface RawEntry {
  d?: unknown;
  c?: unknown;
  e?: unknown;
  p?: unknown;
}

function parseBundle(json: unknown): Map<number, EffectTemplate> {
  const out = new Map<number, EffectTemplate>();
  const data = (json as { data?: { E?: Record<string, RawEntry> } }).data?.E;
  if (!data) {
    return out;
  }
  for (const [key, raw] of Object.entries(data)) {
    const id = Number.parseInt(key, 10);
    if (!Number.isFinite(id) || typeof raw?.d !== "string") {
      continue;
    }
    const letter = typeof raw.e === "string" ? raw.e : "";
    out.set(id, {
      description: raw.d,
      characteristic: typeof raw.c === "number" ? raw.c : 0,
      element: ELEMENT_BY_LETTER[letter] ?? null,
      priority: typeof raw.p === "number" ? raw.p : 0,
    });
  }
  return out;
}

/**
 * Loads (once) the effects lang bundle. Idempotent and safe to call from
 * render — the promise is shared, and subscribers are notified when it
 * lands so a component that rendered before the fetch can re-render.
 */
export function loadEffectsLang(): Promise<Map<number, EffectTemplate>> {
  if (templates) {
    return Promise.resolve(templates);
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
        templates = parseBundle(json);
        log.debug(`loaded ${templates.size} effect templates`);
        for (const cb of listeners) {
          cb();
        }
        return templates;
      })
      .catch((err) => {
        log.error("failed to load effects lang bundle:", err);
        // Latch an empty map: without the bundle every effect falls back
        // to its numeric form, which beats re-fetching on every render.
        templates = new Map();
        for (const cb of listeners) {
          cb();
        }
        return templates;
      });
  }
  return loading;
}

/** Subscribe to the one-shot "bundle is ready" notification. */
export function subscribeEffectsLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isEffectsLangReady(): boolean {
  return templates !== null;
}

export interface FormattedEffect {
  text: string;
  element: EffectElement | null;
  characteristic: number;
  /** Display-order hint — see `EffectTemplate.priority`. */
  priority: number;
}

export interface EffectValues {
  effectId: number;
  min: number;
  max: number;
  special: number;
  duration: number;
}

/**
 * Renders one spell effect as the sentence the spell book shows.
 *
 * The pattern language is Ankama's (`ank.utils.PatternDecoder`):
 *
 *   `#n`            substitute value n (1 = min, 2 = max, 3 = special)
 *   `{~a TEXT}`     keep TEXT only when value a is present
 *   `{~a~b TEXT}`   keep TEXT only when values a AND b are both present
 *
 * "Present" is what makes the range collapse work: a fixed-value effect
 * has no upper bound, so `Dommages : #1{~1~2 à }#2 (terre)` renders as
 * "Dommages : 22 (terre)" rather than "22 à 22". The wire format has no
 * null, so `max` counts as absent when it is 0 or equal to `min` — the
 * two shapes migration 0039 leaves behind for a fixed value.
 */
export function formatEffect(effect: EffectValues): FormattedEffect | null {
  const template = templates?.get(effect.effectId);
  if (!template) {
    return null;
  }

  const values: (number | null)[] = [
    effect.min,
    effect.max === 0 || effect.max === effect.min ? null : effect.max,
    effect.special === 0 ? null : effect.special,
    null,
  ];

  // Buffs and ground entities carry their lifetime outside the pattern —
  // the templates only ever describe the magnitude.
  let text = decodeEffectPattern(template.description, values);
  if (effect.duration > 0) {
    text += ` (${effect.duration} ${effect.duration > 1 ? "tours" : "tour"})`;
  }

  return {
    text,
    element: template.element,
    characteristic: template.characteristic,
    priority: template.priority,
  };
}

/**
 * Ankama's `ank.utils.PatternDecoder`. See `formatEffect` above for what the
 * pattern language means.
 *
 * `values` takes strings as well as numbers because the same decoder runs on
 * NPC dialogue (`Question.initialize` → `PatternDecoder.getDescription`),
 * whose `#N` parameters arrive as text. Nothing here does arithmetic on a
 * value — every branch either tests it for presence or stringifies it — so
 * widening the type is all it takes.
 */
export function decodeEffectPattern(
  pattern: string,
  values: (string | number | null)[]
): string {
  const withGroups = pattern.replace(
    /\{~(\d)(?:~(\d))?([^}]*)\}/g,
    (_all, a: string, b: string | undefined, body: string) => {
      const first = values[Number(a) - 1];
      if (first === null || first === undefined) {
        return "";
      }
      if (b !== undefined) {
        const second = values[Number(b) - 1];
        if (second === null || second === undefined) {
          return "";
        }
      }
      return body;
    }
  );

  return withGroups.replace(/#(\d)/g, (_all, n: string) => {
    const value = values[Number(n) - 1];
    return value === null || value === undefined ? "" : String(value);
  });
}
