// ============================================================================
// Item System Types — mirrors original Dofus 1.29 structures
// ============================================================================

/**
 * Equipment slot positions (from EquipmentPosition.java).
 * -1 = not equipped (in inventory bag).
 */
/**
 * Equipment slot positions.
 *
 * Canonical source is `I.ss` in the 1.29 lang bundle
 * (`assets/langs/fr/items.json`, `data.I.ss`), which lists the equipment
 * positions each superType may occupy — e.g. superType 4 (belt) → `[3]`,
 * superType 3 (ring) → `[4, 2]`. That is verifiable against the retail
 * client's own data; the previous version of this table cited
 * `EquipmentPosition.java`/`Inventory.as:508` without those files in the
 * repo and had BELT and RING_RIGHT swapped (3 and 4) as a result. If this
 * table is ever "corrected" again, re-derive it from `I.ss`, not from
 * memory of the Java enum.
 */
export const EquipmentPosition = {
  NOT_EQUIPPED: -1,
  AMULET: 0,
  WEAPON: 1,
  RING_LEFT: 2,
  BELT: 3,
  RING_RIGHT: 4,
  BOOTS: 5,
  HAT: 6,
  CAPE: 7,
  PET: 8,
  DOFUS_1: 9,
  DOFUS_2: 10,
  DOFUS_3: 11,
  DOFUS_4: 12,
  DOFUS_5: 13,
  DOFUS_6: 14,
  SHIELD: 15,
  MOUNT: 16,
} as const;

export type EquipmentPositionValue =
  (typeof EquipmentPosition)[keyof typeof EquipmentPosition];

/**
 * Which look ordinal (the client's accessory slot, `Inventory.as`'s
 * `_ctrN`) an equipped position renders into. Only worn pieces with a
 * visible representation on the character appear here; amulet/ring/belt/
 * boots/dofus/mount have none and are absent.
 */
export const LOOK_ORDINAL_BY_POSITION: Record<number, number> = {
  [EquipmentPosition.WEAPON]: 0,
  [EquipmentPosition.HAT]: 1,
  [EquipmentPosition.CAPE]: 2,
  [EquipmentPosition.PET]: 3,
  [EquipmentPosition.SHIELD]: 4,
};

/**
 * Item super-types — broad classification for filtering and for equip
 * position lookup (`I.ss[superType]`).
 *
 * Values are `I.t[*].t` in the lang bundle, i.e. what an item's *type*
 * declares as its super-type. The previous version of this table invented
 * its own numbering starting the non-equippable block at 6; it did not
 * match the bundle at all past AMULET/WEAPON/RING/BELT/BOOT.
 */
export const ItemSuperType = {
  NONE: 0,
  AMULET: 1,
  WEAPON: 2,
  RING: 3,
  BELT: 4,
  BOOT: 5,
  CONSUMABLE: 6,
  SHIELD: 7,
  SOUL: 8,
  RESOURCE: 9,
  HAT: 10,
  CAPE: 11,
  PET: 12,
  DOFUS: 13,
  QUEST: 14,
  DOCUMENT: 15,
  RUNE: 16,
  BOOST_FOOD: 17,
  BENEDICTION: 18,
  MALEDICTION: 19,
  ROLEPLAY_BUFF: 20,
  MOUNT: 21,
  CARD: 24,
} as const;

export type ItemSuperTypeValue =
  (typeof ItemSuperType)[keyof typeof ItemSuperType];

/**
 * Item categories / types (from ItemCategory.java).
 * Maps type ID → item category name.
 */
export const ItemCategory = {
  AMULET: 1,
  BOW: 2,
  WAND: 3,
  STAFF: 4,
  DAGGER: 5,
  SWORD: 6,
  HAMMER: 7,
  SHOVEL: 8,
  RING: 9,
  BELT: 10,
  BOOT: 11,
  POTION: 12,
  EXPERIENCE_PARCHMENT: 13,
  GIFT: 14,
  RESOURCE: 15,
  HAT: 16,
  CLOAK: 17,
  PET: 18,
  AXE: 19,
  TOOL: 20,
  PICKAXE: 21,
  SCYTHE: 22,
  DOFUS: 23,
  QUEST: 24,
  DOCUMENT: 25,
  ALCHEMY_POTION: 26,
  BOOST_FOOD: 28,
  BENEDICTION: 29,
  MALEDICTION: 30,
  ROLEPLAY_GIFT: 31,
  FOLLOWING: 32,
  BREAD: 33,
  CEREAL: 34,
  FLOWER: 35,
  PLANT: 36,
  BEER: 37,
  WOOD: 38,
  ORE: 39,
  ALLOY: 40,
  FISH: 41,
  CANDY: 42,
  FORGET_POTION: 43,
  JOB_POTION: 44,
  SPELL_POTION: 45,
  FRUIT: 46,
  BONE: 47,
  POWDER: 48,
  COMESTIBLE_FISH: 49,
  PRECIOUS_STONE: 50,
  STONE: 51,
  FLOUR: 52,
  FEATHER: 53,
  HAIR: 54,
  FABRIC: 55,
  LEATHER: 56,
  WOOL: 57,
  SEED: 58,
  SKIN: 59,
  OIL: 60,
  STUFFED_TOY: 61,
  GUTTED_FISH: 62,
  MEAT: 63,
  PRESERVED_MEAT: 64,
  TAIL: 65,
  METARIA: 66,
  LEG: 68,
  WING: 69,
  EGG: 70,
  EAR: 71,
  PET_EGG: 72,
  PET_FOOD: 73,
  PET_GHOST: 74,
  MAGIC_CURE: 75,
  SMITHMAGIC_RUNE: 78,
  DRINK: 79,
  QUEST_OBJECT: 80,
  BACKPACK: 81,
  SHIELD: 82,
  SOUL_STONE: 83,
  KEY: 84,
  FULL_SOUL_STONE: 85,
  PERCEPTOR_RESOURCE: 86,
  MOUNT: 91,
  BREEDING: 95,
  CROSSBOW: 102,
  LEG2: 103,
  WING2: 104,
  CARD: 105,
  PLANK: 106,
  BARK: 107,
  COMPOST: 108,
  TOOTH: 109,
  HOOF: 110,
  BEAK: 111,
  EYE: 112,
  JELLY: 113,
  MAGIC_WEAPON: 114,
  SMITHMAGIC_POTION: 115,
  MUTATION: 116,
  BOOST_FOOD2: 117,
  PRISM: 118,
  CARD_119: 119,
  CARD_120: 120,
  CARD_121: 121,
  CARD_122: 122,
  TTG_BOOSTER: 123,
  FULL_SOUL_BOSS: 124,
  FULL_SOUL_ARCHI: 125,
  FAIRYWORK: 126,
  LIVING_OBJECT: 127,
  FAIRYWORK_ACC: 128,
  CEREMONIAL_ITEM: 129,
  PET_CERTIFICATE: 130,
} as const;

export type ItemCategoryValue =
  (typeof ItemCategory)[keyof typeof ItemCategory];

// ============================================================================
// Item Effects
// ============================================================================

/**
 * Common item effect type IDs — stat modifiers, special actions, etc.
 * Only the most used ones; the full list has 200+ entries.
 */
export const ItemEffectId = {
  // Stat boosts
  ADD_STRENGTH: 118,
  ADD_INTELLIGENCE: 126,
  ADD_CHANCE: 123,
  ADD_AGILITY: 119,
  ADD_VITALITY: 125,
  ADD_WISDOM: 124,
  ADD_AP: 111,
  ADD_MP: 128,
  ADD_RANGE: 117,
  ADD_SUMMONS: 182,
  ADD_DAMAGE: 112,
  ADD_PHYSICAL_DAMAGE: 142,
  ADD_CRITICAL_HIT: 115,
  ADD_CRITICAL_FAILURE: 122,
  ADD_INITIATIVE: 174,
  ADD_DISCERNMENT: 176,
  ADD_HEAL: 178,
  ADD_POWER: 138,
  ADD_PODS: 158,
  ADD_DAMAGE_REFLECT: 220,

  // Trap boosts
  ADD_TRAP_DAMAGE: 225,
  ADD_TRAP_DAMAGE_PERCENT: 226,

  // Dodge boosts
  ADD_AP_DODGE: 160,
  ADD_MP_DODGE: 161,

  // Resistances (flat)
  ADD_RES_NEUTRAL: 240,
  ADD_RES_EARTH: 241,
  ADD_RES_WATER: 242,
  ADD_RES_AIR: 243,
  ADD_RES_FIRE: 244,

  // Resistances (percent)
  ADD_RES_NEUTRAL_PERCENT: 210,
  ADD_RES_EARTH_PERCENT: 211,
  ADD_RES_WATER_PERCENT: 213,
  ADD_RES_AIR_PERCENT: 212,
  ADD_RES_FIRE_PERCENT: 214,

  // Negative stat modifiers
  SUB_STRENGTH: 157,
  SUB_INTELLIGENCE: 155,
  SUB_CHANCE: 152,
  SUB_AGILITY: 154,
  SUB_VITALITY: 153,
  SUB_WISDOM: 156,
  SUB_AP: 168,
  SUB_MP: 169,
  SUB_RANGE: 116,
  SUB_INITIATIVE: 175,
  SUB_DISCERNMENT: 177,
  SUB_CRITICAL_HIT: 171,
  SUB_DAMAGE: 164,
  SUB_PODS: 159,

  // Special
  HEAL_HP: 108,
  STEAL_HP_NEUTRAL: 95,
  STEAL_HP_EARTH: 97,
  STEAL_HP_WATER: 96,
  STEAL_HP_AIR: 98,
  STEAL_HP_FIRE: 99,

  // Living object / cosmetic
  INCARNATION: 669,
  CUSTOM_SKIN: 969,
  GIVE_TITLE: 724,
  LEARN_EMOTE: 10,
  CRAFTED_BY: 988,
  LOCK: 2155,
  LOCK_TEMPORARY: 2154,
} as const;

export type ItemEffectIdValue =
  (typeof ItemEffectId)[keyof typeof ItemEffectId];

/**
 * A single effect on an item instance.
 * Format in original protocol: "effectId#param1#param2#param3"
 */
export interface ItemEffect {
  /** Effect type ID */
  id: number;
  /** Minimum value (or only value for fixed effects) */
  min: number;
  /** Maximum value (0 if fixed) */
  max: number;
  /** Optional third parameter (duration, target, etc.) */
  param3?: number;
  /** Optional text parameter (e.g. crafted-by name) */
  text?: string;
}

// ============================================================================
// Item Instance — what lives in an inventory
// ============================================================================

/**
 * An item instance in a character's inventory.
 * Mirrors the original Dofus Item class.
 */
export interface InventoryItem {
  /** Unique instance ID (server-generated) */
  uid: number;
  /** Item template ID (references item_templates) */
  templateId: number;
  /** Stack quantity */
  quantity: number;
  /** Equipment position (-1 = not equipped, see EquipmentPosition) */
  position: number;
  /** Item effects (rolled stats for this instance) */
  effects: ItemEffect[];
  /** Item category / type (for icon path) */
  type: number;
  /** GFX ID (for icon path) */
  gfxId: number;
  /** Item name (denormalized for display) */
  name: string;
}

/**
 * Static item template data (loaded from DB / lang files).
 * Describes an item archetype, not a specific instance.
 */
export interface ItemTemplate {
  /** Template ID */
  id: number;
  /** Display name */
  name: string;
  /** Item category (see ItemCategory) */
  type: number;
  /** Item level */
  level: number;
  /** Weight in pods */
  weight: number;
  /** GFX ID for icon display */
  gfxId: number;
  /** Possible equipment positions for this item type */
  equipPositions: number[];
  /** Default/possible effects (stat ranges) */
  effects: ItemEffect[];
  /** Item set ID (0 = no set) */
  itemSetId: number;
  /** Two-handed weapon */
  twoHanded: boolean;
  /** Whether the item is usable (consumable) */
  usable: boolean;
  /** Whether the item is stackable */
  stackable: boolean;
  /** Description text */
  description: string;
}

// ============================================================================
// Inventory weight
// ============================================================================

export interface InventoryWeightPayload {
  /** Current total weight in pods */
  current: number;
  /** Maximum weight capacity */
  max: number;
}

// ============================================================================
// Client → Server Payloads
// ============================================================================

/** Move item to a new position (equip/unequip/reorder) */
export interface ItemMoveRequestPayload {
  /** Item unique instance ID */
  uid: number;
  /** Target position (EquipmentPosition or -1 for bag) */
  position: number;
  /** Quantity to move (for splitting stacks) */
  quantity?: number;
}

/** Use a consumable item */
export interface ItemUseRequestPayload {
  uid: number;
}

/** Drop item on the ground */
export interface ItemDropRequestPayload {
  uid: number;
  quantity: number;
}

/** Destroy item permanently */
export interface ItemDestroyRequestPayload {
  uid: number;
  quantity: number;
}

// ============================================================================
// Server → Client Payloads
// ============================================================================

/** Full inventory sync (sent on login / map load) */
export interface InventoryListPayload {
  items: InventoryItem[];
  kamas: number;
  weight: InventoryWeightPayload;
}

/** One or more items added to inventory */
export interface ItemAddPayload {
  items: InventoryItem[];
}

/** Item removed from inventory */
export interface ItemRemovePayload {
  uid: number;
}

/** Item quantity changed (stack update) */
export interface ItemQuantityPayload {
  uid: number;
  quantity: number;
}

/** Item moved / position changed (equip confirm) */
export interface ItemMovePayload {
  uid: number;
  position: number;
}
