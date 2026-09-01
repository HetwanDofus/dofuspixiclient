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
 * The skills that need nothing of the character.
 *
 * Entering a house, opening a chest and using a zaap are available to anyone
 * standing in front of them, so they are a fixed list. Everything else is a
 * job skill and is decided by what the server has told us about *this*
 * character — see `canUseJobSkill` in `game/stores/jobs-store`. That is the
 * difference QA-123 asks for: the menu used to be a hardcoded whitelist and
 * greyed a resource the character could perfectly well harvest.
 */
export const UNCONDITIONAL_INTERACTIVE_SKILLS: ReadonlySet<number> = new Set([
  84, // Entrer — house door
  104, // Ouvrir — storage / bank
  114, // Utiliser — zaap
]);
