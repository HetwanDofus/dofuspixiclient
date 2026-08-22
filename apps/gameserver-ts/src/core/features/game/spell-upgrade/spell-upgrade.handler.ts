import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import {
  SpellListSchema,
  type SpellUpgradeRequest,
  SpellUpgradeRequestSchema,
  SpellUpgradeSchema,
} from "@dofus/proto/spells_pb";
import { PlayersRepository } from "@modules/players/players.repository";
import { spellUpgradeCost } from "@modules/spells/spell-upgrade-cost";
import { SpellsRepository } from "@modules/spells/spells.repository";
import { SpellsService } from "@modules/spells/spells.service";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

/**
 * SU — spend spell points to raise one spell by a level.
 *
 * Four gates, all server-side (the panel greys the `+` button on the
 * same rules, but the client is not the authority):
 *   1. the player must own the spell,
 *   2. a next level must exist in `spell_levels`,
 *   3. the character level must reach that level's `min_player_level`,
 *   4. the player must hold `spellUpgradeCost(currentLevel)` points.
 *
 * Gate 4 is enforced by the debit itself rather than by the read above
 * it, and the debit runs *before* the level is granted. Frames dispatch
 * fire-and-forget (`GatewayFrameService.onFrame`), so two upgrade
 * requests interleave at every await: both would read the same balance
 * and both would pass a read-then-write check, buying two levels for one
 * point. `spendSpellPoints` folds the affordability test into the UPDATE,
 * so exactly one of them wins.
 *
 * Granting after debiting means the only failure left is a debit whose
 * level grant then no-ops (two frames for the *same* spell, both
 * affordable). That one is unwound with an explicit refund.
 */
@Injectable()
export class SpellUpgradeHandler {
  private readonly logger = new Logger(SpellUpgradeHandler.name);

  constructor(
    private readonly sessions: SessionRegistry,
    private readonly frames: GatewayFrameService,
    private readonly players: PlayersRepository,
    private readonly spells: SpellsRepository,
    private readonly spellsService: SpellsService,
    private readonly stats: StatsService
  ) {}

  @MessageHandler(SpellUpgradeRequestSchema)
  async handle(ctx: HandlerContext, msg: SpellUpgradeRequest): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }
    const characterId = session.characterId;

    const [player, owned] = await Promise.all([
      this.players.findById(characterId),
      this.spells.findPlayerSpell(characterId, msg.spellId),
    ]);

    if (!player || !owned) {
      this.reject(ctx.sessionId, msg.spellId, owned?.level ?? 0);
      return;
    }

    const nextLevel = owned.level + 1;
    const nextRow = await this.spells.findLevel(msg.spellId, nextLevel);
    const cost = spellUpgradeCost(owned.level);

    if (
      !nextRow ||
      player.level < nextRow.minPlayerLevel ||
      player.spellPoints < cost
    ) {
      this.reject(ctx.sessionId, msg.spellId, owned.level);
      return;
    }

    // Debit first: this, not the `player.spellPoints < cost` read above,
    // is what actually reserves the points against a concurrent frame.
    const debited = await this.players.spendSpellPoints(characterId, cost);
    if (debited === 0) {
      this.reject(ctx.sessionId, msg.spellId, owned.level);
      return;
    }

    const updated = await this.spells.setPlayerSpellLevel(
      characterId,
      msg.spellId,
      nextLevel
    );
    if (updated === 0) {
      // Another in-flight frame already bought this level. Hand the
      // points back rather than charging for a level nobody gained.
      await this.players.refundSpellPoints(characterId, cost);
      this.reject(ctx.sessionId, msg.spellId, owned.level);
      return;
    }

    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "spellUpgrade",
          value: create(SpellUpgradeSchema, {
            success: true,
            spellId: msg.spellId,
            newLevel: nextLevel,
          }),
        },
      })
    );

    // The new level changes AP cost, range and effects, so the client's
    // SpellList snapshot (which the hotbar and the cast machine read) is
    // now stale — re-push it rather than letting the client guess.
    const spellData = await this.spellsService.buildSpellList(characterId);
    this.frames.broadcast(
      [ctx.sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "spellList",
          value: create(SpellListSchema, { spells: spellData }),
        },
      })
    );

    // Refresh "Capital sorts" in the panel — the point balance lives on
    // the As frame, not on the SU response.
    await this.stats.sendStats(ctx.sessionId, characterId);

    this.logger.log(
      `spell-upgrade player=${characterId} spell=${msg.spellId} ` +
        `level=${owned.level}->${nextLevel} cost=${cost}`
    );
  }

  private reject(sessionId: string, spellId: number, level: number): void {
    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "spellUpgrade",
          value: create(SpellUpgradeSchema, {
            success: false,
            spellId,
            newLevel: level,
          }),
        },
      })
    );
  }
}
