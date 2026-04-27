import type { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import type { Fight } from "@modules/fight/core/fight.entity";
import { create } from "@bufbuild/protobuf";
import { SpriteType } from "@dofus/proto/common_pb";
import {
  FightResultSchema,
  GameEndSchema,
  GameMovementSchema,
  SpriteMovementEntry_Operation,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { FightHistoryRepository } from "@modules/fight/engine/fight.history.repository";
import { FightType, type TeamSide } from "@modules/fight/fight.types";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { MapTransitionService } from "@modules/maps/maps.transition.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

@Injectable()
export class FightEndService {
  private readonly logger = new Logger(FightEndService.name);

  constructor(
    private readonly registry: FightRegistryService,
    private readonly frames: GatewayFrameService,
    private readonly historyRepo: FightHistoryRepository,
    private readonly players: PlayersRepository,
    private readonly presence: PlayerPresenceService,
    private readonly transition: MapTransitionService
  ) {}

  async endFight(fight: Fight): Promise<void> {
    const winner = this.detectWinner(fight);
    const durationMs = Date.now() - fight.startedAt;

    // Calculate rewards for PvM
    let totalXp = 0;
    let totalKamas = 0;
    if (fight.type === FightType.PvM) {
      const loserTeam = winner === 0 ? 1 : 0;
      for (const f of fight.teams[loserTeam].fighters()) {
        totalXp += f.monsterXp;
        totalKamas += Math.floor(
          f.monsterKamasMin +
            Math.random() * (f.monsterKamasMax - f.monsterKamasMin + 1)
        );
      }
    }

    // Apply challenge bonuses
    let challengeXpBonus = 0;
    let challengeDropBonus = 0;
    for (const mod of fight.modules.all()) {
      if (
        typeof mod === "object" &&
        mod !== null &&
        "challengeId" in mod &&
        "won" in mod &&
        "xpBonusPct" in mod
      ) {
        const challenge = mod as FightChallenge;
        // Auto-succeed surviving challenges at fight end
        if (challenge.alive) {
          challenge.succeed();
        }
        if (challenge.won) {
          challengeXpBonus += challenge.xpBonusPct;
          challengeDropBonus += challenge.dropBonusPct;
        }
      }
    }

    // Apply bonus percentages
    totalXp = Math.floor((totalXp * (100 + challengeXpBonus)) / 100);
    totalKamas = Math.floor((totalKamas * (100 + challengeDropBonus)) / 100);

    // Distribute equally among winning player fighters
    const winnerPlayers = fight.teams[winner]
      .fighters()
      .filter((f) => f.sessionId);
    const xpPerPlayer =
      winnerPlayers.length > 0 ? Math.floor(totalXp / winnerPlayers.length) : 0;
    const kamasPerPlayer =
      winnerPlayers.length > 0
        ? Math.floor(totalKamas / winnerPlayers.length)
        : 0;

    // Build results
    const results = fight.fighters().map((f) => {
      const isWinner = f.team?.side === winner;
      return create(FightResultSchema, {
        spriteId: String(f.id),
        name: f.name,
        level: f.player?.level ?? f.monsterLevel ?? 1,
        isDead: f.dead,
        team: f.team?.side ?? 0,
        xpWon: BigInt(isWinner && f.sessionId ? xpPerPlayer : 0),
        kamaWon: BigInt(isWinner && f.sessionId ? kamasPerPlayer : 0),
      });
    });

    // Broadcast GE to all fight participants
    const targets = fight.allSessions();

    const removeEntries = fight.fighters().map((f) =>
      create(SpriteMovementEntrySchema, {
        operation: SpriteMovementEntry_Operation.REMOVE,
        spriteId: String(f.id),
      })
    );
    if (removeEntries.length > 0) {
      this.frames.broadcast(
        targets,
        create(DofusMessageSchema, {
          payload: {
            case: "gameMovement",
            value: create(GameMovementSchema, { entries: removeEntries }),
          },
        })
      );
    }

    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameEnd",
          value: create(GameEndSchema, {
            durationMs,
            winnerTeam: winner,
            initId: 0,
            fightType: fight.type,
            starBonus: 0,
            results,
          }),
        },
      })
    );

    // Persist fight history
    const now = new Date();
    const historyResult = await this.historyRepo.insertHistory({
      type: fight.type,
      mapId: fight.mapId,
      startedAt: new Date(fight.startedAt),
      endedAt: now,
      winnerTeam: winner,
      durationMs,
    });

    // Insert fight participants
    for (const fighter of fight.fighters()) {
      const isWinner = fighter.team?.side === winner;
      const xpGained = isWinner && fighter.sessionId ? xpPerPlayer : 0;
      const kamasGained = isWinner && fighter.sessionId ? kamasPerPlayer : 0;

      await this.historyRepo.insertParticipant({
        fightId: historyResult.id,
        playerId: fighter.player ? String(fighter.player.id) : null,
        monsterId: fighter.monsterTemplateId || null,
        team: fighter.team?.side ?? 0,
        xpGained: String(xpGained),
        kamasGained: String(kamasGained),
        dead: fighter.dead,
        leftFight: false,
      });

      // Update player stats
      if (isWinner && fighter.player) {
        await this.players.addXpAndKamas(
          String(fighter.player.id),
          xpGained,
          kamasGained
        );

        const updated = await this.players.findById(String(fighter.player.id));
        if (updated) {
          const currentXp = Number(updated.experience);
          const nextLevelXp = (updated.level + 1) * (updated.level + 1) * 10;
          if (currentXp >= nextLevelXp) {
            await this.players.levelUp(String(fighter.player.id));
            this.logger.log(
              `Player ${fighter.player.id} leveled up to ${updated.level + 1}`
            );
          }
        }
      }
    }

    // Clean buffs and states for all fighters
    for (const f of fight.fighters()) {
      f.buffs.clear();
      f.states.clearAll();
    }
    // Clean spell usage tracker
    fight.spellUsage.clear();

    // Handle losers: respawn at savepoint
    for (const fighter of fight.fighters()) {
      if (!fighter.sessionId || !fighter.player) {
        continue;
      }

      const isWinner = fighter.team?.side === winner;
      if (fighter.dead && !isWinner) {
        const playerData = await this.players.findById(
          String(fighter.player.id)
        );
        if (playerData) {
          await this.transition.teleport(
            fighter.sessionId,
            String(fighter.player.id),
            playerData.savepointMapId,
            playerData.savepointCellId,
            3
          );
        }
      }
    }

    // Re-add survivor player sprites to exploration map for other viewers
    for (const fighter of fight.fighters()) {
      if (!fighter.sessionId || !fighter.player || fighter.dead) {
        continue;
      }

      const presence = this.presence.getByCharacter(String(fighter.player.id));
      if (!presence) {
        continue;
      }

      const mapSessions = this.presence.sessionsOnMap(
        presence.mapId,
        String(fighter.player.id)
      );
      if (mapSessions.length === 0) {
        continue;
      }

      // Send ADD sprite for this player to everyone else on the map
      this.frames.broadcast(
        mapSessions,
        create(DofusMessageSchema, {
          payload: {
            case: "gameMovement",
            value: create(GameMovementSchema, {
              entries: [
                create(SpriteMovementEntrySchema, {
                  operation: SpriteMovementEntry_Operation.ADD,
                  spriteType: SpriteType.CHARACTER,
                  spriteId: String(fighter.player.id),
                  cellId: presence.cellId,
                  direction: presence.direction,
                  name: presence.name,
                  level: presence.level,
                  gfxId: presence.gfx,
                  scaleX: 100,
                  scaleY: 100,
                }),
              ],
            }),
          },
        })
      );
    }

    // Cleanup
    this.registry.remove(fight.id);
    this.logger.log(
      `Fight ${fight.id} ended — winner: team ${winner}, duration: ${durationMs}ms, xp: ${totalXp}, kamas: ${totalKamas}`
    );
  }

  private detectWinner(fight: Fight): TeamSide {
    const alive0 = fight.teams[0].fighters().filter((f) => !f.dead).length;
    if (alive0 === 0) {
      return 1 as TeamSide;
    }
    return 0 as TeamSide;
  }
}
