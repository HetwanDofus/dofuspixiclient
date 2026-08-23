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
 * Roll one instance from a template's effect list.
 *
 * Each effect lands somewhere in `[param1, param2]` inclusive. A
 * template whose `param2` is zero or below `param1` is a fixed effect,
 * not a range — the 1.29 data uses that for everything from a set bonus
 * to a weapon's own damage line — and is copied through untouched.
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
    if (effect.param2 <= effect.param1) {
      return effect;
    }

    const span = effect.param2 - effect.param1 + 1;
    const value = effect.param1 + Math.floor(random() * span);

    return { ...effect, param1: value, param2: value };
  });
}
