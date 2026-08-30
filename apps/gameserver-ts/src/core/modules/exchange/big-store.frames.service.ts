import type { MessageInitShape } from "@bufbuild/protobuf";
import type { ListingGroup } from "@modules/exchange/big-store.pricing";
import type { ListingWithStock } from "@modules/exchange/big-store.repository";
import type { Hall } from "@modules/exchange/hdv.service";
import { create } from "@bufbuild/protobuf";
import {
  BigStoreListingLineSchema,
  BigStoreOwnListingSchema,
  ExchangeBigStoreItemListSchema,
  ExchangeBigStoreMiddlePriceSchema,
  ExchangeBigStoreMovementSchema,
  ExchangeBigStoreOwnListSchema,
  ExchangeBigStoreOwnMovementSchema,
  ExchangeBigStoreParamsSchema,
  ExchangeBigStoreTypeItemsSchema,
  ExchangeBuySchema,
  ExchangeCreateSchema,
  ExchangeSellSchema,
} from "@dofus/proto/exchange_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { LOT_SIZES } from "@modules/exchange/big-store.pricing";
import { toItemData } from "@modules/inventory/inventory.frames.service";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/**
 * The frames an auction house sends.
 *
 * Kept out of `ExchangeFramesService` — which is the shared vocabulary
 * of every exchange — because none of these mean anything to the other
 * seventeen types: an auction house is the only one that lists what
 * *other players* are selling.
 *
 * The opening order matters here as it does for a storage, and it is a
 * different order: `EC` first, then the hall's parameters, then (in sell
 * mode) the seller's own stock. Everything the buy mode shows is pulled
 * afterwards by the client, one category at a time.
 */
@Injectable()
export class BigStoreFramesService {
  constructor(private readonly frames: GatewayFrameService) {}

  /** `EC` then `EHK` — the opening pair, in that order and never apart. */
  open(sessionId: string, kind: number, hall: Hall, npcId: number): void {
    this.send(sessionId, {
      case: "exchangeCreate",
      value: create(ExchangeCreateSchema, {
        success: true,
        exchangeType: kind,
      }),
    });

    this.send(sessionId, {
      case: "exchangeBigstoreParams",
      value: create(ExchangeBigStoreParamsSchema, {
        lotSizes: [...LOT_SIZES],
        types: hall.types,
        typeNames: hall.typeNames,
        taxPercent: hall.taxPercent,
        levelMax: hall.levelMax,
        maxItems: hall.maxItems,
        npcId,
        sellTimeHours: hall.sellTimeHours,
      }),
    });
  }

  /** `EHL` — the templates on sale in one category. */
  typeItems(sessionId: string, typeId: number, templateIds: number[]): void {
    this.send(sessionId, {
      case: "exchangeBigstoreTypeItems",
      value: create(ExchangeBigStoreTypeItemsSchema, {
        category: typeId,
        templateIds,
      }),
    });
  }

  /**
   * `EHM` — one template appeared in or vanished from a category.
   *
   * Sent to every session browsing that category, so a list built ten
   * seconds ago does not offer a template nobody sells any more.
   */
  typeMovement(
    sessionIds: string[],
    add: boolean,
    typeId: number,
    templateId: number
  ): void {
    if (sessionIds.length === 0) {
      return;
    }

    this.broadcast(sessionIds, {
      case: "exchangeBigstoreMovement",
      value: create(ExchangeBigStoreMovementSchema, {
        add,
        category: typeId,
        templateId,
      }),
    });
  }

  /** `EHl` — the price grid for one template. */
  itemList(
    sessionId: string,
    templateId: number,
    groups: ListingGroup[]
  ): void {
    this.send(sessionId, {
      case: "exchangeBigstoreItemList",
      value: create(ExchangeBigStoreItemListSchema, {
        templateId,
        lines: groups.map((group) => toLine(group)),
      }),
    });
  }

  /** `EHo` — every lot this seller has on sale here. */
  ownList(sessionId: string, listings: ListingWithStock[]): void {
    this.send(sessionId, {
      case: "exchangeBigstoreOwnList",
      value: create(ExchangeBigStoreOwnListSchema, {
        listings: listings.map((listing) => toOwnListing(listing)),
      }),
    });
  }

  /** `EHO` — one of the seller's own lots appeared or went away. */
  ownMovement(
    sessionId: string,
    add: boolean,
    listing: ListingWithStock | string
  ): void {
    const removed = typeof listing === "string";

    this.send(sessionId, {
      case: "exchangeBigstoreOwnMov",
      value: create(ExchangeBigStoreOwnMovementSchema, {
        add,
        lineId: BigInt(removed ? listing : listing.listing.id),
        ...(removed ? {} : { listing: toOwnListing(listing) }),
      }),
    });
  }

  /**
   * `EHP` — what this template has been selling for.
   *
   * `-1` is 1.29's "never sold here" and the client prints a sentence
   * for it rather than a number.
   */
  middlePrice(sessionId: string, templateId: number, average?: number): void {
    this.send(sessionId, {
      case: "exchangeBigstoreMiddlePrice",
      value: create(ExchangeBigStoreMiddlePriceSchema, {
        itemId: templateId,
        averagePrice: BigInt(average ?? -1),
      }),
    });
  }

  /** `ES` — the outcome of putting a lot on sale. */
  sold(sessionId: string, success: boolean, errorCode = ""): void {
    this.send(sessionId, {
      case: "exchangeSell",
      value: create(ExchangeSellSchema, { success, errorCode }),
    });
  }

  /** `EB` — the outcome of buying one. */
  bought(sessionId: string, success: boolean, errorCode = ""): void {
    this.send(sessionId, {
      case: "exchangeBuy",
      value: create(ExchangeBuySchema, { success, errorCode }),
    });
  }

  /** `EC` with `success: false` — the hall never opens. */
  refuse(sessionId: string, reason: string): void {
    this.send(sessionId, {
      case: "exchangeCreate",
      value: create(ExchangeCreateSchema, {
        success: false,
        errorCode: reason,
      }),
    });
  }

  private send(sessionId: string, payload: BigStorePayload): void {
    this.broadcast([sessionId], payload);
  }

  private broadcast(sessionIds: string[], payload: BigStorePayload): void {
    this.frames.broadcast(sessionIds, create(DofusMessageSchema, { payload }));
  }
}

/** The frames this service is allowed to put on the wire. */
type BigStorePayload = Extract<
  NonNullable<MessageInitShape<typeof DofusMessageSchema>["payload"]>,
  {
    case:
      | "exchangeCreate"
      | "exchangeSell"
      | "exchangeBuy"
      | "exchangeBigstoreParams"
      | "exchangeBigstoreTypeItems"
      | "exchangeBigstoreMovement"
      | "exchangeBigstoreItemList"
      | "exchangeBigstoreOwnList"
      | "exchangeBigstoreOwnMov"
      | "exchangeBigstoreMiddlePrice";
  }
>;

function toLine(group: ListingGroup) {
  return create(BigStoreListingLineSchema, {
    lineId: BigInt(group.lineId),
    templateId: group.templateId,
    priceQty1: group.prices[1],
    priceQty10: group.prices[10],
    priceQty100: group.prices[100],
    item: toItemData(group.item),
  });
}

function toOwnListing({ listing, item }: ListingWithStock) {
  return create(BigStoreOwnListingSchema, {
    lineId: BigInt(listing.id),
    item: toItemData(item),
    lotSize: listing.lotSize,
    price: BigInt(listing.price),
  });
}
