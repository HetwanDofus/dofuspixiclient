import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  type SpellMoveRequest,
  SpellMoveRequestSchema,
  SpellMoveSchema,
  SpellRemoveSchema,
} from "@dofus/proto/spells_pb";
import {
  isLegalSlot,
  MAX_SHORTCUT_SLOT,
} from "@modules/shortcuts/shortcuts.repository";
import {
  SpellsRepository,
  UNSLOTTED_POSITION,
} from "@modules/spells/spells.repository";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * SM — drop a spell onto a hotbar slot, and the SR that pulls one out.
 *
 * The slot is the same 1..42 space item shortcuts use, but the two bars
 * are stored apart (`player_spells.position` vs `player_item_shortcuts`)
 * because 1.29 shows them on two exclusive tabs: slot 3 holds a spell
 * *and* an item, one per tab.
 *
 * A spell dropped on an occupied slot **swaps** with its occupant when
 * it comes from the bar, and evicts it when it comes from the book.
 * 1.29's `MouseShortcuts.spellMove` always evicts, but it also has no
 * way to reach a slot other than by dropping on it, so an eviction there
 * costs a placement the player can redo in one gesture; here it cost the
 * bar's whole arrangement every time a drop landed a cell off. The
 * client hears an SR for every slot that ends up empty, and an SM per
 * spell that moved.
 */
@Injectable()
export class SpellMoveHandler {
  private readonly logger = new Logger(SpellMoveHandler.name);

  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>,
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService,
    private readonly spells: SpellsRepository
  ) {}

  @MessageHandler(SpellMoveRequestSchema)
  async handle(ctx: HandlerContext, msg: SpellMoveRequest): Promise<void> {
    const characterId = this.sessions.get(ctx.sessionId)?.characterId;

    if (!characterId) {
      return;
    }

    // `newSlot === UNSLOTTED_POSITION` is how the client asks for a
    // removal — a spell dragged off the bar. Any other out-of-range
    // slot is a malformed frame.
    const unslotting = msg.newSlot === UNSLOTTED_POSITION;

    if (!unslotting && !isLegalSlot(msg.newSlot)) {
      this.logger.debug(
        `spell move refused: slot=${msg.newSlot} outside 1..${MAX_SHORTCUT_SLOT}`
      );
      return;
    }

    await this.txHost.withTransaction(async () => {
      const owned = await this.spells.findPlayerSpell(characterId, msg.spellId);

      if (!owned) {
        this.logger.debug(
          `spell move refused: character=${characterId} does not own spell=${msg.spellId}`
        );
        return;
      }

      if (owned.position === msg.newSlot) {
        return;
      }

      if (unslotting) {
        if (owned.position !== UNSLOTTED_POSITION) {
          this.sendRemove(ctx.sessionId, owned.position);
        }
        await this.spells.setPlayerSpellPosition(
          characterId,
          msg.spellId,
          UNSLOTTED_POSITION
        );
        return;
      }

      const occupant = await this.spells.findPlayerSpellAtPosition(
        characterId,
        msg.newSlot
      );

      // Two spells already on the bar trade places. Anything else and
      // the destination's tenant is pushed off it: a spell coming from
      // the book has no slot to give in return.
      const swapping =
        occupant !== undefined && owned.position !== UNSLOTTED_POSITION;

      if (!swapping && owned.position !== UNSLOTTED_POSITION) {
        this.sendRemove(ctx.sessionId, owned.position);
      }

      if (occupant) {
        await this.spells.setPlayerSpellPosition(
          characterId,
          occupant.spellId,
          swapping ? owned.position : UNSLOTTED_POSITION
        );

        if (!swapping) {
          this.sendRemove(ctx.sessionId, msg.newSlot);
        }
      }

      await this.spells.setPlayerSpellPosition(
        characterId,
        msg.spellId,
        msg.newSlot
      );

      // The mover's SM goes out first: it is what evicts the occupant
      // client-side, and the occupant's own SM then claims the slot the
      // mover left. Sent the other way round, the second frame would
      // find the mover still sitting there and unslot it.
      this.sendMove(ctx.sessionId, msg.spellId, msg.newSlot);

      if (swapping && occupant) {
        this.sendMove(ctx.sessionId, occupant.spellId, owned.position);
      }
    });
  }

  private sendMove(sessionId: string, spellId: number, position: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "spellMove",
          value: create(SpellMoveSchema, { spellId, position }),
        },
      })
    );
  }

  private sendRemove(sessionId: string, position: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "spellRemove",
          value: create(SpellRemoveSchema, { position }),
        },
      })
    );
  }
}
