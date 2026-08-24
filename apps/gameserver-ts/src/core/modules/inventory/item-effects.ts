/**
 * Rolling an item's stats at creation time — the "jets" of Dofus 1.29.
 *
 * `item_templates.effects` stores the 1.29 shape the world importer
 * decodes from `type#param1#param2#param3`, where for a range effect
 * `param1` is the minimum and `param2` the maximum. A template is a
 * recipe, not an item: two Gelano off the same template have different
 * numbers because each instance rolls once, at the moment it is created,
 * and keeps that roll for life.
 *
 * Nothing in this project ever created an item before QA-060, so this is
 * the first roller. `StatsService.computeEquipmentStats` used to read the
 * template and take `param1` — the minimum — for every worn item; it now
 * prefers the instance's stored roll and only falls back to the template
 * for items seeded by hand straight into SQL with an empty `effects`.
 *
 * `param3` is left untouched: on a weapon it holds a dice formula
 * (`1d7+0`) that is not ours to interpret here.
 */

export interface ItemEffect {
  id: number;
  param1: number;
  param2: number;
  param3: string;
}

/** Narrow the loose `Json` an item template carries into effect rows. */
export function parseItemEffects(raw: unknown): ItemEffect[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const out: ItemEffect[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const e = entry as Record<string, unknown>;
    const id = Number(e.id ?? e.effectId ?? 0);

    if (!Number.isFinite(id) || id <= 0) {
      continue;
    }

    out.push({
      id,
      param1: Number(e.param1 ?? e.min ?? e.value ?? 0) || 0,
      param2: Number(e.param2 ?? e.max ?? 0) || 0,
      param3: typeof e.param3 === "string" ? e.param3 : "",
    });
  }

  return out;
}

/**
 * `param3` for a real jet ("j": true in `assets/dist/langs/fr/effects.json`
 * — every stat boost, weapon damage, resistance…) is always a dice formula
 * like `1d7+0` or `0d0+2`, min-populated by the importer from the same
 * `#param1#param2#param3` triple `param1`/`param2` come from. An effect
 * the bundle does *not* mark as a jet — pet bookkeeping (800/806/807/808),
 * "Lié au compte" (983), a tool's `Résistance : #2 / #3` (812) — never
 * carries that shape: it's a bare number ("64", "a", "ca") or an id-typed
 * flag. That difference is already sitting in the data the server has on
 * hand, so this is what tells a roll from a non-roll, without loading the
 * lang bundle just to read one boolean.
 *
 * QA-079: this was previously unconditional on `param2 > param1`, which
 * also matched effect 800 ("Points de vie : #3", param1=5, param2=72 on
 * some pets) and produced a random, permanently-wrong pet HP display.
 */
const DICE_NOTATION = /^\d+d\d+[+-]\d+$/;

/**
 * Roll one instance from a template's effect list.
 *
 * Each effect lands somewhere in `[param1, param2]` inclusive. A
 * template whose `param2` is zero or below `param1`, or whose `param3`
 * isn't a dice formula (see `DICE_NOTATION` above), is not a range to
 * roll — the 1.29 data uses "param2 > param1" for things as different as
 * a weapon's own damage spread and a pet's untouched bookkeeping bounds —
 * and is copied through untouched.
 *
 * The rolled value is written into **both** `param1` and `param2` so the
 * stored row reads as a fixed effect, which is what an instance is: the
 * roll is over.
 */
export function rollItemEffects(
  templateEffects: unknown,
  random: () => number = Math.random
): ItemEffect[] {
  return parseItemEffects(templateEffects).map((effect) => {
    if (effect.param2 <= effect.param1 || !DICE_NOTATION.test(effect.param3)) {
      return effect;
    }

    const span = effect.param2 - effect.param1 + 1;
    const value = effect.param1 + Math.floor(random() * span);

    return { ...effect, param1: value, param2: value };
  });
}
