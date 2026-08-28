import type { ItemOwner } from "@modules/items/item-owner";
import { ExchangeType } from "@dofus/proto/common_pb";

/**
 * Which exchange a session is in.
 *
 * These are the client's own ids (`dofus/aks/Exchange.as:355`), which is
 * why they come from the proto enum rather than being restated here —
 * the value on the wire *is* the window that opens.
 */
export type ExchangeKind = ExchangeType;

/**
 * One open exchange, from the server's point of view.
 *
 * Deliberately plain data, and deliberately JSON-serialisable: this is
 * what crosses a blue/green restart in `ExchangeRegistryService`. Any
 * field that cannot survive `JSON.stringify` does not belong here.
 */
export interface ExchangeSession {
  sessionId: string;
  characterId: string;
  accountId: string;
  kind: ExchangeKind;
  /** The container on the far side. The near side is always the player. */
  remote: ItemOwner;
  /**
   * `"pending"` means the request has gone out and nobody has accepted
   * yet — there is no window on either client, only a yes/no box. Only a
   * two-sided exchange has this phase; a storage is `"open"` from the
   * moment it exists.
   *
   * The phase is what makes a pending request *occupy* both players
   * without any extra bookkeeping: the occupancy lock, the socket-close
   * sweep and the handoff all key off the session, so a request that is
   * already a session gets all three for free.
   */
  phase: ExchangePhase;
  /**
   * Which queue in `ExchangeSerializer` this session's operations run
   * on.
   *
   * A storage locks alone, so this is its own `sessionId`. **Both sides
   * of a trade share one key**, which is the deadlock-free answer to
   * QA-107's "two sessions to lock together": there is one queue, not
   * two locks, so A's `EK` can never interleave with B's `EMO`.
   */
  lockKey: string;
  /** Set only for a two-sided exchange; the key into `TradeRegistry`. */
  tradeId?: string;
  /** When it opened, for logs and for a future idle timeout. */
  openedAt: number;
}

/** See `ExchangeSession.phase`. */
export type ExchangePhase = "pending" | "open";

export type CloseReason =
  /** The player closed the window. */
  | "left"
  /** The socket went away. */
  | "disconnected"
  /** The core restarted and could not restore the session. */
  | "restarted"
  /** A precondition stopped holding — a fight started, say. */
  | "interrupted";

/** Why an exchange could not be opened. */
export type OpenDenialReason =
  | "already-exchanging"
  | "in-fight"
  | "not-in-world"
  /** The other player is busy — the `EREO` of the canonical client. */
  | "target-busy"
  /** Nobody of that id is in the world. */
  | "target-not-found"
  /** 1.29 has no cross-map trade; see the map check in `TradeFlow`. */
  | "different-map"
  /** A player asked to trade with themselves. */
  | "self";

/**
 * A storage exchange has no validation phase: 1.29's `onCreate` case 5
 * never builds `datacenter.Exchange`, so an `EK` frame would dereference
 * undefined on the client. Every movement commits on its own.
 */
export const STORAGE_COMMIT_IS_IMMEDIATE = true;
