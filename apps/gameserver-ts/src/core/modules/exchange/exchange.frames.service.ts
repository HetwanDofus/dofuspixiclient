import type { ExchangeSession } from "@modules/exchange/exchange.types";
import type { ItemRow } from "@shared/db/schema";
import { create } from "@bufbuild/protobuf";
import {
  ExchangeCreateSchema,
  ExchangeDistantMovementSchema,
  ExchangeItemMovementSchema,
  ExchangeKamaMovementSchema,
  ExchangeLeaveSchema,
  ExchangeListSchema,
  ExchangeLocalMovementSchema,
  ExchangeReadySchema,
  ExchangeRequestSchema,
  ExchangeStorageMovementSchema,
} from "@dofus/proto/exchange_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { toItemData } from "@modules/inventory/inventory.frames.service";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/**
 * The frames an exchange sends.
 *
 * The ordering rule lives here rather than in each flow because getting
 * it wrong is silent, and it is *not the same rule for every kind*:
 *
 *   - a storage needs `EC` **then** `EL`, because
 *     `dofus.datacenter.Storage` has no inventory array until an `EL`
 *     assigns one and every `Es` before that is dropped without a word;
 *   - a trade needs `EC` **alone**, because `onCreate` case 1 builds its
 *     model from the client's own inventory clone and an `EL` would be
 *     read as a storage list.
 *
 * So there are two openers — `open()` and `openTrade()` — and no way to
 * send a bare `EC` by accident on the path that must not have one.
 */
@Injectable()
export class ExchangeFramesService {
  constructor(private readonly frames: GatewayFrameService) {}

  /**
   * `EC` then `EL` — the opening pair, in that order and never apart.
   *
   * See `proto/exchange.proto`'s note on `ExchangeList`: canonical
   * `dofus.datacenter.Storage` does not allocate its inventory until an
   * `EL` lands.
   */
  open(session: ExchangeSession, contents: ItemRow[], kamas: bigint): void {
    this.frames.broadcast(
      [session.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeCreate",
          value: create(ExchangeCreateSchema, {
            success: true,
            exchangeType: session.kind,
          }),
        },
      })
    );

    this.frames.broadcast(
      [session.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeList",
          value: create(ExchangeListSchema, {
            items: contents.map((row) => toItemData(row)),
            kamas,
          }),
        },
      })
    );
  }

  /** `EC` with `success: false` — the window never opens. */
  refuse(sessionId: string, reason: string): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeCreate",
          value: create(ExchangeCreateSchema, {
            success: false,
            errorCode: reason,
          }),
        },
      })
    );
  }

  /**
   * `Es` — one stack on the far side changed.
   *
   * `quantity` inside `item` is the stack's **absolute** size after the
   * change, not a delta; on a removal only the id is read. That is the
   * client's contract, and it is why callers pass a row rather than a
   * difference.
   */
  storageItem(sessionId: string, add: boolean, item: ItemRow): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeStorageMovement",
          value: create(ExchangeStorageMovementSchema, {
            success: true,
            movement: {
              case: "item",
              value: create(ExchangeItemMovementSchema, {
                add,
                item: toItemData(item),
              }),
            },
          }),
        },
      })
    );
  }

  /** `Es` for kamas. Absolute, like the item form. */
  storageKamas(sessionId: string, kamas: bigint): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeStorageMovement",
          value: create(ExchangeStorageMovementSchema, {
            success: true,
            movement: {
              case: "kama",
              value: create(ExchangeKamaMovementSchema, { quantity: kamas }),
            },
          }),
        },
      })
    );
  }

  /**
   * `EV`. Idempotent on the client, so it is safe to send unprompted.
   *
   * `completed` is what tells the two messages apart: canonical
   * `onLeave` prints "Echange effectue" for a trade that went through
   * and "Echange annule" for everything else, and it is the only signal
   * a player gets that the deal actually happened.
   */
  leave(sessionId: string, completed = false): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeLeave",
          value: create(ExchangeLeaveSchema, { success: true, completed }),
        },
      })
    );
  }

  /**
   * `ER` — a trade has been proposed. Sent to **both** players.
   *
   * The same frame goes to each: canonical `onRequest` works out which
   * box to show by comparing its own id with `initiator_id`, so the
   * server does not need to know, and cannot get it wrong.
   */
  request(
    sessionIds: readonly string[],
    initiator: { id: string; name: string },
    target: { id: string; name: string },
    kind: number
  ): void {
    this.frames.broadcast(
      sessionIds,
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeRequest",
          value: create(ExchangeRequestSchema, {
            success: true,
            initiatorId: initiator.id,
            initiatorName: initiator.name,
            targetId: target.id,
            targetName: target.name,
            exchangeType: kind,
          }),
        },
      })
    );
  }

  /** `ER` with `success: false` — the proposal never reaches the target. */
  refuseRequest(sessionId: string, reason: string): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeRequest",
          value: create(ExchangeRequestSchema, {
            success: false,
            errorCode: reason,
          }),
        },
      })
    );
  }

  /**
   * `EC` alone — for a trade, and **only** for a trade.
   *
   * The counterpart of `open()`, and the reason that one is not reusable
   * here: `onCreate` case 1 builds its model from
   * `Player.Inventory.deepClone()` and starts both offers empty, so
   * there is no list to send. An `EL` after this would be read as a
   * *storage* list and would corrupt the window.
   */
  openTrade(sessionIds: readonly string[], kind: number): void {
    this.frames.broadcast(
      sessionIds,
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeCreate",
          value: create(ExchangeCreateSchema, {
            success: true,
            exchangeType: kind,
          }),
        },
      })
    );
  }

  /**
   * `EK` — one player's validation flag.
   *
   * Goes to both sides, naming whose flag it is: the client compares
   * `player_id` with its own to decide which half of the window to
   * tint. Sending only to the other player would leave the sender's own
   * button unlit.
   */
  ready(
    sessionIds: readonly string[],
    playerId: string,
    isReady: boolean
  ): void {
    this.frames.broadcast(
      sessionIds,
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeReady",
          value: create(ExchangeReadySchema, { isReady, playerId }),
        },
      })
    );
  }

  /**
   * `EM` / `Em` — one line of an offer changed.
   *
   * Two frames for one event, because the client keeps the two offers in
   * different arrays and reads a different message into each. The mover
   * gets `EM`, the watcher `Em`; sending the same case to both would
   * make each player see their own pile change twice and the other's
   * never.
   *
   * `item.quantity` is the **absolute** size of the offer for that
   * stack, not a delta, exactly as in `Es`: `modifyLocal` replaces the
   * entry it finds and appends when it finds none.
   */
  offerItem(mine: string, theirs: string, add: boolean, item: ItemRow): void {
    const movement = {
      case: "item" as const,
      value: create(ExchangeItemMovementSchema, {
        add,
        item: toItemData(item),
      }),
    };

    this.frames.broadcast(
      [mine],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeLocalMovement",
          value: create(ExchangeLocalMovementSchema, {
            success: true,
            movement,
          }),
        },
      })
    );

    this.frames.broadcast(
      [theirs],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeDistantMovement",
          value: create(ExchangeDistantMovementSchema, {
            success: true,
            movement,
          }),
        },
      })
    );
  }

  /** `EM` / `Em` for kamas. Absolute, like the item form. */
  offerKamas(mine: string, theirs: string, kamas: bigint): void {
    const movement = {
      case: "kama" as const,
      value: create(ExchangeKamaMovementSchema, { quantity: kamas }),
    };

    this.frames.broadcast(
      [mine],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeLocalMovement",
          value: create(ExchangeLocalMovementSchema, {
            success: true,
            movement,
          }),
        },
      })
    );

    this.frames.broadcast(
      [theirs],
      create(DofusMessageSchema, {
        payload: {
          case: "exchangeDistantMovement",
          value: create(ExchangeDistantMovementSchema, {
            success: true,
            movement,
          }),
        },
      })
    );
  }
}
