/**
 * Who holds a stack.
 *
 * `items.owner_kind` + `items.owner_id` is the whole reason an exchange
 * is one `UPDATE` rather than a DELETE here and an INSERT there. Every
 * kind below is a container the game already has a concept for; only
 * `Player` and `Bank` are produced today, and the rest are declared so
 * the numbering is settled once instead of being renegotiated each time
 * a container is added.
 *
 * These values are persisted. Never renumber one.
 */
export const OwnerKind = {
  /** A character's bag and what they wear. `ownerId` is `players.id`. */
  Player: 1,
  /** The account bank, shared by every character of the account. */
  Bank: 2,
  /** A house chest. `ownerId` is `houses.id`. */
  House: 3,
  /** An auction-house listing's held stock. */
  BigStore: 4,
  /** A merchant-mode stall, which outlives its owner's session. */
  Merchant: 5,
  /** A guild tax collector's takings. */
  TaxCollector: 6,
  /** A mount's saddlebags. */
  Mount: 7,
  /** A paddock. */
  Paddock: 8,
} as const;

export type OwnerKindValue = (typeof OwnerKind)[keyof typeof OwnerKind];

/** A container, named the way every item query wants to be given one. */
export interface ItemOwner {
  kind: OwnerKindValue;
  id: string;
}

export function playerOwner(playerId: string): ItemOwner {
  return { kind: OwnerKind.Player, id: playerId };
}

/**
 * The bank is keyed by **account**, not by character: in 1.29 the chest
 * is how a player moves things between their own characters, so keying
 * it by character would remove the point of it.
 */
export function bankOwner(accountId: string): ItemOwner {
  return { kind: OwnerKind.Bank, id: accountId };
}

export function houseOwner(houseId: string): ItemOwner {
  return { kind: OwnerKind.House, id: houseId };
}

export function sameOwner(a: ItemOwner, b: ItemOwner): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** For log lines and ledger reads — never parsed back. */
export function describeOwner(owner: ItemOwner): string {
  const name =
    Object.entries(OwnerKind).find(([, v]) => v === owner.kind)?.[0] ??
    String(owner.kind);

  return `${name}#${owner.id}`;
}
