import type { ItemRow, ItemTemplateRow } from "@shared/db/schema";
import { create } from "@bufbuild/protobuf";
import { ItemDataSchema, ItemEffectSchema } from "@dofus/proto/common_pb";
import {
  ItemAddSchema,
  ItemMovementSchema,
  ItemQuantitySchema,
  ItemRemoveSchema,
  ItemTemplateDataSchema,
  ItemTemplatesSchema,
  ItemWeightSchema,
} from "@dofus/proto/items_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import { parseItemEffects } from "@modules/inventory/item-effects";
import { ItemPresentationCacheService } from "@modules/inventory/item-presentation.cache";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/**
 * Telling a client about the items it owns.
 *
 * The client has had `itemAdd` bound to its inventory store from the
 * start; the server had simply never emitted a single `item*` frame,
 * because nothing had ever created an item. QA-060 opens that tap, so
 * this is where the frames are built — in one place, so loot, merchants,
 * exchanges and the bank all describe an item the same way.
 */
@Injectable()
export class InventoryFramesService {
  constructor(
    private readonly inventory: InventoryRepository,
    private readonly presentation: ItemPresentationCacheService,
    private readonly frames: GatewayFrameService
  ) {}

  /** Announce one newly-created (or newly-grown) stack. */
  sendItemAdd(sessionId: string, item: ItemRow): void {
    this.send(sessionId, [item]);
  }

  /**
   * Send the character's whole inventory.
   *
   * Called on entering the game: without it, an item looted in one
   * session is invisible in the next — it is in the database and
   * nowhere on screen, which reads exactly like the loot never worked.
   */
  async sendInventory(sessionId: string, playerId: string): Promise<void> {
    const items = await this.inventory.findByPlayer(playerId);

    if (items.length === 0) {
      return;
    }

    this.send(sessionId, items);
  }

  /** Confirm an equip/unequip move for one item. */
  sendMovement(sessionId: string, itemId: string, position: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemMovement",
          value: create(ItemMovementSchema, {
            itemUnicId: Number(itemId),
            position,
          }),
        },
      })
    );
  }

  /** A stack shrank (or grew) without changing identity — e.g. one used. */
  sendItemQuantity(sessionId: string, itemId: string, quantity: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemQuantity",
          value: create(ItemQuantitySchema, {
            itemUnicId: Number(itemId),
            newQuantity: quantity,
          }),
        },
      })
    );
  }

  /** A stack was fully consumed and the row deleted. */
  sendItemRemove(sessionId: string, itemId: string): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemRemove",
          value: create(ItemRemoveSchema, { itemUnicId: Number(itemId) }),
        },
      })
    );
  }

  /** Current / max carrying capacity, in pods. */
  sendWeight(sessionId: string, current: number, max: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemWeight",
          value: create(ItemWeightSchema, {
            currentWeight: current,
            maxWeight: max,
          }),
        },
      })
    );
  }

  /**
   * `sendTemplates` for every distinct template a player currently owns
   * (bag + equipped). Called once on entering the game, right after
   * `sendInventory` — the client needs to know what an `ItemData.item_id`
   * *is* before it can draw a single icon or tooltip.
   */
  async sendTemplatesForPlayer(
    sessionId: string,
    playerId: string
  ): Promise<void> {
    const items = await this.inventory.findByPlayer(playerId);
    const templateIds = [...new Set(items.map((item) => item.templateId))];
    const templates = await Promise.all(
      templateIds.map((id) => this.inventory.findTemplate(id))
    );

    await this.sendTemplates(
      sessionId,
      templates.filter((t): t is ItemTemplateRow => t !== undefined)
    );
  }

  /**
   * The presentation of one template, for a client that may not own it.
   *
   * Templates are otherwise sent once, on entering the game, for what the
   * character carries (`sendTemplatesForPlayer`) — which leaves an item
   * *offered by somebody else* in a trade with no name, no icon and no
   * card. This is the hole that plugs: idempotent on the client, where
   * `handleItemTemplates` is a `set` into a `Map`.
   */
  async sendTemplateFor(sessionId: string, templateId: number): Promise<void> {
    const template = await this.inventory.findTemplate(templateId);

    if (!template) {
      return;
    }

    await this.sendTemplates(sessionId, [template]);
  }

  /**
   * Presentation data (name, description, type, legal equip positions…)
   * for a set of templates. This is how the client learns what an item
   * *is* without ever loading `items.json` itself — the wire only ever
   * carries a template id (`ItemData.item_id`), same as the client
   * already relies on the server to resolve a spell's name.
   */
  async sendTemplates(
    sessionId: string,
    templates: readonly ItemTemplateRow[]
  ): Promise<void> {
    if (templates.length === 0) {
      return;
    }

    const data = await Promise.all(
      templates.map((template) => this.toTemplateData(template))
    );

    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemTemplates",
          value: create(ItemTemplatesSchema, { templates: data }),
        },
      })
    );
  }

  private async toTemplateData(template: ItemTemplateRow) {
    const type = await this.presentation.loadType(template.type);
    const superType = await this.presentation.loadSuperType(template.superType);

    return create(ItemTemplateDataSchema, {
      id: template.id,
      name: template.name,
      description: template.description,
      typeId: template.type,
      typeName: type?.name ?? "",
      superType: template.superType,
      level: template.level,
      weight: template.weight,
      gfxId: template.gfxId,
      usable: template.usable,
      targetable: template.targetable,
      twoHanded: template.twoHanded,
      itemSetId: template.itemSetId,
      positions: superType?.positions ?? [],
      criteria: template.criteria,
    });
  }

  private send(sessionId: string, items: readonly ItemRow[]): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "itemAdd",
          value: create(ItemAddSchema, {
            success: true,
            items: items.map((item) => toItemData(item)),
          }),
        },
      })
    );
  }
}

/**
 * This project's `ItemEffect.param3` (mapped onto `ItemEffectSchema.param4`
 * below) doubles as two different things depending on the effect: a dice
 * formula on a jet (`"1d7+0"`) or a bare hexadecimal integer on a non-jet
 * (`"a"` = 10, `"64"` = 100) — the same raw 1.29 field, just two different
 * uses of it. `import-starloco-content.ts` already decodes that hex shape
 * for `param1`/`param2`; it had just never been applied here.
 *
 * `ItemEffectSchema.param3` — the wire's *numeric* third param, distinct
 * from `param4` — is where a pattern like effect 800's "Points de vie :
 * #3" reads its value (`formatEffect`'s `special` slot). A dice formula
 * has no single integer to decode, so it sends 0 there, same as before.
 */
const HEX_INTEGER = /^[0-9a-fA-F]+$/;

function decodeParam3(raw: string): number {
  return HEX_INTEGER.test(raw) ? Number.parseInt(raw, 16) : 0;
}

/**
 * An item row as the wire describes it.
 *
 * Exported because the bank, a chest and every later exchange have to
 * describe an item exactly the way the inventory does — this file's own
 * docblock promised that, and an exchange building its own `ItemData`
 * would be the first place the two descriptions could drift.
 */
export function toItemData(item: ItemRow) {
  return create(ItemDataSchema, {
    itemId: item.templateId,
    // `player_items.id` is a bigserial and the 1.29 protocol carries the
    // instance id as a 32-bit value. Nothing in this project comes close
    // to overflowing it, but the narrowing is deliberate and belongs
    // here rather than being implied at a dozen call sites.
    unicId: Number(item.id),
    quantity: item.quantity,
    position: item.position,
    effects: parseItemEffects(item.effects).map((effect) =>
      create(ItemEffectSchema, {
        effectType: effect.id,
        param1: effect.param1,
        param2: effect.param2,
        param3: decodeParam3(effect.param3),
        param4: effect.param3,
      })
    ),
  });
}
