import { ExchangeType } from "@dofus/proto";

import type { MessageHandler } from "@/game/network/message-handler";
import { closeBigStore, openBigStore } from "@/game/stores/bigstore-store";
import { characterStore } from "@/game/stores/character-store";
import { appendInfoMessage } from "@/game/stores/chat-store";
import {
  applyBenchItem,
  applyCraftLoop,
  applyCraftLoopEnd,
  applyCraftResult,
  closeCraft,
  craftStore,
  lastRequestedSkill,
  openCraft,
} from "@/game/stores/craft-store";
import {
  closeCrafterList,
  openCrafterList,
  setCrafters,
} from "@/game/stores/crafter-store";
import {
  applyExchangeItem,
  applyExchangeKamas,
  closeExchange,
  openExchange,
  setExchangeContents,
} from "@/game/stores/exchange-store";
import { craftSlotsOf } from "@/game/stores/jobs-store";
import {
  applyCoopItem,
  applyPayItem,
  applyPayKamas,
  applySecureCraftResult,
  closeSecureCraft,
  openSecureCraft,
  secureCraftStore,
} from "@/game/stores/secure-craft-store";
import {
  applyTradeItem,
  applyTradeKamas,
  applyTradeReady,
  closeTrade,
  openTradeRequest,
  openTradeWindow,
  tradeStore,
} from "@/game/stores/trade-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("Exchange");

/**
 * The whole exchange protocol, both shapes.
 *
 * `EC` is the fork: a storage opens the bank window and is always
 * followed by an `EL`, a trade opens the two-offer window and never is.
 * Everything downstream of that follows the kind — `Es` moves a
 * container's contents, `EM`/`Em` move an offer — so this handler routes
 * on `exchange_type` once and the stores stay unaware of each other.
 */
export class ExchangeHandler {
  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  private register(): void {
    // --- Player-to-player -------------------------------------------

    this.messageHandler.on("exchangeRequest", (payload) => {
      if (!payload.success) {
        log.debug(`exchange request refused: ${payload.errorCode}`);
        closeTrade();
        return;
      }

      // One frame, two readings: whoever finds their own id in
      // `initiatorId` is the one waiting for an answer, the other is
      // the one being asked. Canonical `onRequest` works it out the
      // same way, which is why the server sends the same frame to both.
      const me = String(characterStore.getSnapshot().id);
      const amInitiator = payload.initiatorId === me;

      openTradeRequest(
        amInitiator,
        amInitiator ? payload.targetId : payload.initiatorId,
        amInitiator ? payload.targetName : payload.initiatorName,
        payload.exchangeType
      );
    });

    this.messageHandler.on("exchangeReady", (payload) => {
      const me = String(characterStore.getSnapshot().id);
      applyTradeReady(
        payload.playerId === me ? "mine" : "theirs",
        payload.isReady
      );
    });

    this.messageHandler.on("exchangeLocalMovement", (payload) => {
      // The bench and a trade offer share `EM`: one is one-sided and the
      // other is not, and only one of the two windows is ever open.
      if (craftStore.getSnapshot().open) {
        applyBenchItem(
          payload.movement.case === "item" ? payload.movement.value.add : false,
          payload.movement.case === "item"
            ? payload.movement.value.item
            : undefined
        );
        return;
      }

      applyOffer("mine", payload.movement);
    });

    this.messageHandler.on("exchangeDistantMovement", (payload) => {
      applyOffer("theirs", payload.movement);
    });

    // --- Shared ------------------------------------------------------

    this.messageHandler.on("exchangeCreate", (payload) => {
      if (!payload.success) {
        log.debug(`exchange refused: ${payload.errorCode}`);
        closeExchange();
        closeTrade();
        closeBigStore();
        return;
      }

      if (payload.exchangeType === ExchangeType.EXCHANGE_PLAYER) {
        openTradeWindow();
        return;
      }

      // The auction house is two exchange types, one per mode, and its
      // parameters arrive in the `EHK` that always follows.
      if (payload.exchangeType === ExchangeType.EXCHANGE_BIGSTORE_SELL) {
        openBigStore("sell");
        return;
      }

      if (payload.exchangeType === ExchangeType.EXCHANGE_BIGSTORE_BUY) {
        openBigStore("buy");
        return;
      }

      if (payload.exchangeType === ExchangeType.EXCHANGE_SECURE_CRAFT_CLIENT) {
        openSecureCraft("customer");
        return;
      }

      if (payload.exchangeType === ExchangeType.EXCHANGE_SECURE_CRAFT_ARTISAN) {
        openSecureCraft("artisan");
        return;
      }

      if (payload.exchangeType === ExchangeType.EXCHANGE_CRAFTER_LIST) {
        openCrafterList();
        return;
      }

      if (payload.exchangeType === ExchangeType.EXCHANGE_CRAFT) {
        // Which bench this is comes from the click that opened it, not
        // from the frame: `EC` carries only a type. The grid's size comes
        // from `JS`'s `param1` for that skill, which the server computed
        // from the same level it froze into the session — the two cannot
        // disagree.
        const skillId = lastRequestedSkill();
        openCraft(skillId, craftSlotsOf(skillId));
        return;
      }

      openExchange(payload.exchangeType);
    });

    this.messageHandler.on("exchangeList", (payload) => {
      setExchangeContents(payload.items, Number(payload.kamas));
    });

    this.messageHandler.on("exchangeStorageMovement", (payload) => {
      const movement = payload.movement;

      if (movement.case === "item" && movement.value.item) {
        applyExchangeItem(movement.value.add, movement.value.item);
        return;
      }

      if (movement.case === "kama") {
        applyExchangeKamas(Number(movement.value.quantity));
      }
    });

    // --- The workbench ------------------------------------------------

    this.messageHandler.on("exchangeCoopMovement", (payload) => {
      applyCoopItem(
        payload.movement.case === "item" ? payload.movement.value.add : false,
        payload.movement.case === "item"
          ? payload.movement.value.item
          : undefined
      );
    });

    this.messageHandler.on("exchangePayMovement", (payload) => {
      if (payload.movement.case === "kama") {
        applyPayKamas(Number(payload.movement.value.quantity));
        return;
      }

      if (payload.movement.case === "item") {
        applyPayItem(payload.movement.value.add, payload.movement.value.item);
      }
    });

    this.messageHandler.on("exchangeCrafterList", (payload) => {
      setCrafters(payload.jobId, payload.crafters);
    });

    this.messageHandler.on("exchangeCraft", (payload) => {
      // `Ec` serves both benches; only one of the two is ever open.
      if (secureCraftStore.getSnapshot().open) {
        applySecureCraftResult(payload.resultCode);
        return;
      }

      applyCraftResult(payload.resultCode);
    });

    this.messageHandler.on("exchangeCraftLoop", (payload) => {
      applyCraftLoop(payload.remaining);
    });

    this.messageHandler.on("exchangeCraftLoopEnd", (payload) => {
      applyCraftLoopEnd(payload.totalCrafted);
    });

    this.messageHandler.on("exchangeLeave", (payload) => {
      // Canonical `onLeave` prints one of two lines depending on the
      // flag, and it is the only confirmation a player gets that the
      // deal actually went through. Only for a trade: a bank window
      // closing is not news.
      if (tradeStore.getSnapshot().phase !== "idle") {
        appendInfoMessage(
          payload.completed ? "Echange effectué" : "Echange annulé"
        );
      }

      closeExchange();
      closeCraft();
      closeCrafterList();
      closeSecureCraft();
      closeTrade();
      closeBigStore();
    });
  }
}

type Movement =
  | { case: "item"; value: { add: boolean; item?: unknown } }
  | { case: "kama"; value: { quantity: bigint } }
  | { case: undefined; value?: undefined };

function applyOffer(side: "mine" | "theirs", movement: Movement): void {
  if (movement.case === "item" && movement.value.item) {
    applyTradeItem(
      side,
      movement.value.add,
      movement.value.item as Parameters<typeof applyTradeItem>[2]
    );
    return;
  }

  if (movement.case === "kama") {
    applyTradeKamas(side, Number(movement.value.quantity));
  }
}
