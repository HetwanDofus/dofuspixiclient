/** One action a click on an interactive element offers, already translated. */
export interface InteractiveSkill {
  id: number;
  /** `SK[id].d` from the skills bundle — "Entrer", "Ouvrir", "Utiliser"… */
  label: string;
}

/**
 * An interactive element as the 1.29 `IO` table describes it: the name shown
 * at the top of the popup menu, the object type, and the skills the menu
 * lists. Keyed by layer-2 gfx id — several gfx share one entry (every house
 * door variant is the same "Porte").
 */
export interface InteractiveObjectData {
  id: number;
  name: string;
  type: number;
  skills: InteractiveSkill[];
}

/** `IO.d[id].t` — what kind of element a gfx is. */
export const InteractiveObjectType = {
  Resource: 1,
  Workbench: 2,
  Zaap: 3,
  Fountain: 4,
  HouseDoor: 5,
  Storage: 6,
  HealingPot: 7,
  Zaapi: 10,
  CraftsmenList: 12,
  Paddock: 13,
  Switch: 14,
  ClassStatue: 15,
} as const;

/**
 * The skills the server actually implements. Everything else is listed in the
 * menu but greyed out, which is what 1.29 does whenever a skill's condition
 * fails — see `Skill.getState` in the decompiled client.
 */
export const IMPLEMENTED_INTERACTIVE_SKILLS: ReadonlySet<number> = new Set([
  84, // Entrer — house door
  104, // Ouvrir — storage / bank
  114, // Utiliser — zaap
]);
