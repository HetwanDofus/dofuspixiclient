/**
 * Structural rules for equipping an item — everything `canEquip` checks
 * that is *not* `item_templates.criteria` (see `equip-criteria.ts` for
 * that half). Pure and DB-free on purpose: the caller (`InventoryService`)
 * assembles the small facts this needs from `item_templates`,
 * `item_super_types` and the player's own state, so every rule here is
 * unit-testable without a database.
 *
 * `item-move.handler.ts` used to accept any position `0..15` for any
 * item — this is what replaces that.
 */

/** The weapon and shield equipment positions, per `I.ss` in the 1.29 bundle. */
const WEAPON_POSITION = 1;
const SHIELD_POSITION = 15;

/** Every equipment position the client can address (`-1` is "unequip"). */
const VALID_POSITIONS = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

export interface EquipCandidate {
  /** Legal positions for the item's superType (`item_super_types.positions`). */
  superTypePositions: readonly number[];
  twoHanded: boolean;
  level: number;
}

/** The subset of an already-equipped item's state the rules need. */
export interface EquippedSlot {
  position: number;
  twoHanded: boolean;
}

export interface EquipCheckInput {
  candidate: EquipCandidate;
  position: number;
  playerLevel: number;
  /** Currently equipped items, excluding the candidate itself. */
  equipped: readonly EquippedSlot[];
  currentPods: number;
  maxPods: number;
}

export type EquipDenialReason =
  | "invalid-position"
  | "level-too-low"
  | "two-handed-conflict"
  | "over-capacity";

export type EquipResult =
  | { ok: true }
  | { ok: false; reason: EquipDenialReason };

/**
 * Checks every structural rule, in the order that gives the most useful
 * refusal reason first: an item that cannot go in this slot at all is a
 * different problem from one that could, but the character is too weak
 * or too laden for right now.
 */
export function canEquip(input: EquipCheckInput): EquipResult {
  const { candidate, position, playerLevel, equipped, currentPods, maxPods } =
    input;

  if (
    !VALID_POSITIONS.has(position) ||
    !candidate.superTypePositions.includes(position)
  ) {
    return { ok: false, reason: "invalid-position" };
  }

  if (playerLevel < candidate.level) {
    return { ok: false, reason: "level-too-low" };
  }

  // A two-handed weapon and a shield can never both be worn, but the two
  // directions are not symmetric. Equipping the shield while a two-handed
  // weapon is on is refused here — there is no shield-shaped compromise
  // to reach for. Equipping the two-handed weapon while a shield is on is
  // *not* refused: `InventoryService.equip` auto-unequips the shield as
  // part of the same transaction instead, because a bigger weapon simply
  // replacing a shield reads as one action to a player, not two.
  if (position === SHIELD_POSITION) {
    const weapon = equipped.find((item) => item.position === WEAPON_POSITION);
    if (weapon?.twoHanded) {
      return { ok: false, reason: "two-handed-conflict" };
    }
  }

  // Equipping something never changes total weight — bag and worn items
  // are summed the same way (see `pods.ts`) — but 1.29 still blocks any
  // bag manipulation while already over capacity, so an equip attempted
  // from an already-overweight state is refused outright.
  if (currentPods > maxPods) {
    return { ok: false, reason: "over-capacity" };
  }

  return { ok: true };
}
