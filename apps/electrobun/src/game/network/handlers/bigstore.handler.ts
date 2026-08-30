import type { MessageHandler } from "@/game/network/message-handler";
import {
  applyBigStoreOwnListing,
  applyBigStoreTypeMovement,
  setBigStoreLines,
  setBigStoreMiddlePrice,
  setBigStoreOwnListings,
  setBigStoreParams,
  setBigStoreTypeItems,
} from "@/game/stores/bigstore-store";
import { appendErrorMessage } from "@/game/stores/chat-store";
import { createLogger } from "@/utils/logger";

const log = createLogger("BigStore");

/**
 * The auction house's own frames.
 *
 * Split from `ExchangeHandler` rather than added to it because none of
 * these describe *your* things: `EHL`, `EHl` and `EHm` are what other
 * players are selling, and they arrive unprompted whenever somebody
 * else's lot changes a shelf you happen to be looking at.
 *
 * `EC` and `EV` stay in `ExchangeHandler` — they open and close every
 * exchange, and the auction house is one more branch there.
 */
export class BigStoreHandler {
  constructor(private readonly messageHandler: MessageHandler) {
    this.register();
  }

  private register(): void {
    this.messageHandler.on("exchangeBigstoreParams", (payload) => {
      setBigStoreParams(payload);
    });

    this.messageHandler.on("exchangeBigstoreTypeItems", (payload) => {
      setBigStoreTypeItems(payload.category, [...payload.templateIds]);
    });

    this.messageHandler.on("exchangeBigstoreMovement", (payload) => {
      applyBigStoreTypeMovement(
        payload.add,
        payload.category,
        payload.templateId
      );
    });

    this.messageHandler.on("exchangeBigstoreItemList", (payload) => {
      setBigStoreLines(payload.templateId, [...payload.lines]);
    });

    this.messageHandler.on("exchangeBigstoreMiddlePrice", (payload) => {
      setBigStoreMiddlePrice(payload.itemId, Number(payload.averagePrice));
    });

    this.messageHandler.on("exchangeBigstoreOwnList", (payload) => {
      setBigStoreOwnListings([...payload.listings]);
    });

    this.messageHandler.on("exchangeBigstoreOwnMov", (payload) => {
      applyBigStoreOwnListing(
        payload.add,
        String(payload.lineId),
        payload.listing ?? undefined
      );
    });

    // A refusal is the only outcome worth a word: 1.29 pops a dialog for
    // it, and silence would read as a click that did nothing.
    this.messageHandler.on("exchangeSell", (payload) => {
      if (!payload.success) {
        log.debug(`listing refused: ${payload.errorCode}`);
        appendErrorMessage(refusalText(payload.errorCode, SELL_REFUSALS));
      }
    });

    this.messageHandler.on("exchangeBuy", (payload) => {
      if (!payload.success) {
        log.debug(`purchase refused: ${payload.errorCode}`);
        appendErrorMessage(refusalText(payload.errorCode, BUY_REFUSALS));
      }
    });

    // `EHS` is the search box landing on a price grid; the server
    // answers with the same shape `EHl` uses.
    this.messageHandler.on("exchangeBigstoreSearch", (payload) => {
      setBigStoreLines(payload.templateId, [...payload.lines]);
    });
  }
}

/**
 * Why a listing was refused, in the sentences the 1.29 lang bundle
 * already carries (`ERROR_64`, `BIGSTORE_BAD_LEVEL`, `ERROR_65`,
 * `ERROR_66`).
 *
 * The server sends its own vocabulary rather than 1.29's numbered
 * errors, because the numbers mean nothing outside the retail client
 * and half of these conditions are ours.
 */
const SELL_REFUSALS: Record<string, string> = {
  "bad-type":
    "Cet objet ne fait pas partie des catégories prévues dans cet hôtel " +
    "de vente.",
  "bad-level": "Cet objet est trop haut niveau pour cet hôtel de vente.",
  "bad-lot": "Cet objet ne peut pas être vendu par lot de cette taille.",
  "bad-price": "Le prix indiqué est invalide.",
  "no-slot": "Vous ne pouvez pas mettre plus d'objets en vente actuellement...",
  "no-tax":
    "Vous ne disposez pas d'assez de kamas pour acquitter la taxe de mise " +
    "en vente...",
  "not-enough": "Tu ne possèdes pas assez de cet objet.",
};

const BUY_REFUSALS: Record<string, string> = {
  "own-sale": "Tu ne peux pas acheter tes propres objets.",
  "price-changed": "Cet objet n'est pas en vente actuellement.",
  "not-found": "Cet objet n'est pas en vente actuellement.",
  "not-enough": "Tu ne disposes pas d'assez de kamas.",
  "no-tax": "Tu ne disposes pas d'assez de kamas.",
};

/** The mapped sentence, or a plain refusal for a reason not listed. */
function refusalText(code: string, table: Record<string, string>): string {
  return table[code] ?? "L'action est impossible.";
}
