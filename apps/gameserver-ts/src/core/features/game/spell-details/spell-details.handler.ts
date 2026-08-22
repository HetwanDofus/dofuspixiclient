import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  type SpellDetailsRequest,
  SpellDetailsRequestSchema,
  SpellDetailsSchema,
} from "@dofus/proto/spells_pb";
import { SpellsService } from "@modules/spells/spells.service";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * Sd — the spell book asks for every level of one spell when the player
 * selects it in the list. Read-only: unknown spells are answered too, so
 * the panel can preview a spell the player has not learned yet, with
 * `playerLevel = 0`.
 *
 * Every request gets a reply, including for a spell id with no level
 * table at all. The client marks a spell pending when it asks and only
 * clears that on an inbound frame, so staying silent would leave the
 * spell unopenable for the rest of the session — an empty `SpellDetails`
 * lets the panel say so and move on.
 */
@Injectable()
export class SpellDetailsHandler {
  constructor(
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService,
    private readonly spells: SpellsService
  ) {}

  @MessageHandler(SpellDetailsRequestSchema)
  async handle(ctx: HandlerContext, msg: SpellDetailsRequest): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }

    const details =
      (await this.spells.buildSpellDetails(session.characterId, msg.spellId)) ??
      create(SpellDetailsSchema, { spellId: msg.spellId });

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: { case: "spellDetails", value: details },
      })
    );
  }
}
