import type { ISpellAnimation } from "@dofus/spell-runtime";

/**
 * Vite-analyzed glob: each `spells/spell-*.ts` becomes its own code-split
 * chunk, loaded on first cast. Keeps initial bundle small while allowing
 * hundreds of bespoke spell implementations.
 */
const spellModules = (
  import.meta as unknown as {
    glob: (
      pattern: string
    ) => Record<
      string,
      () => Promise<Record<string, new () => ISpellAnimation>>
    >;
  }
).glob("../../spells/spell-*.ts");

/**
 * Dynamically import a spell's module + return its animation class.
 * Each module exports `Spell{N}` (e.g. `Spell2903`); falls back to default
 * export if the named export isn't found.
 */
export async function loadSpellClass(
  spellId: number
): Promise<(new () => ISpellAnimation) | null> {
  const path = `../../spells/spell-${spellId}.ts`;
  const loader = spellModules[path];

  if (!loader) {
    return null;
  }

  try {
    const mod = (await loader()) as Record<string, new () => ISpellAnimation>;
    return (
      mod[`Spell${spellId}`] ??
      (mod.default as new () => ISpellAnimation) ??
      null
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[loadSpellClass] Failed to load module ${spellId}:`, err);
    return null;
  }
}
