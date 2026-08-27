// The 1.29 `IO` table's object types, from the lang bundle's `IO.d[id].t`.
// `scripts/import-starloco-triggers.ts` stores them in
// `interactive_objects_templates.type`.
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

// Skill ids, from the lang bundle's `SK` table. Only the three below are
// implemented; the rest of each object's skill list is offered greyed out by
// the client, exactly as 1.29 does when an action's condition fails.
export const InteractiveSkill = {
  /** "Entrer" — a house door. */
  EnterHouse: 84,
  /** "Ouvrir" — a storage: a house chest, or an account bank. */
  OpenStorage: 104,
  /** "Utiliser" — a zaap. */
  UseZaap: 114,
} as const;

/** Every arrival lands facing SW, same convention as scripted-cell teleports. */
export const DEFAULT_LANDING_DIRECTION = 3;

/** Slots an account bank holds. 1.29 grew this with subscriptions; flat here. */
export const BANK_SLOTS = 100;

/** Slots a house chest holds. */
export const HOUSE_STORAGE_SLOTS = 100;
