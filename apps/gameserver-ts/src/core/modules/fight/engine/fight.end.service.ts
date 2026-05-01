import type { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import type { Fight } from "@modules/fight/core/fight.entity";
import { create } from "@bufbuild/protobuf";
import {
  FightResultSchema,
  GameEndSchema,
  GameMovementSchema,
  type SpriteMovementEntry,
  SpriteMovementEntry_Operation,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { FightHistoryRepository } from "@modules/fight/engine/fight.history.repository";
import { FightType, type TeamSide } from "@modules/fight/fight.types";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { MapTransitionService } from "@modules/maps/maps.transition.service";
import { MapMonsterService } from "@modules/monsters/map-monster.service";
import { monsterGroupToSpriteEntry } from "@modules/monsters/map-monster.sprite-entry";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { toSpriteEntry } from "@modules/player-presence/player-presence.sprite-entry";
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
    private readonly transition: MapTransitionService,
    private readonly mapMonsters: MapMonsterService
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

      // Re-add the survivor's sprite to the map for everyone — INCLUDING
      // the surviving player themselves. The fight broadcast a REMOVE
      // for every fighter at the start of `endFight` (including self),
      // so without an ADD back the local view sits empty after the
      // fight-end dialog dismisses and the player thinks they're stuck.
      // We reuse `toSpriteEntry` (the same helper enter-game uses for
      // map-load spawn) so the entry includes colors + accessories —
      // building it inline by hand here was previously dropping all
      // gear so the player respawned naked.
      const otherSessions = this.presence.sessionsOnMap(
        presence.mapId,
        String(fighter.player.id)
      );
      const allSessions = [fighter.sessionId, ...otherSessions];

      this.frames.broadcast(
        allSessions,
        create(DofusMessageSchema, {
          payload: {
            case: "gameMovement",
            value: create(GameMovementSchema, {
              entries: [
                toSpriteEntry(presence, SpriteMovementEntry_Operation.ADD),
              ],
            }),
          },
        })
      );

      // Re-add the rest of the world state (every still-living monster
      // group + every other player) to THIS survivor's view. We REMOVE-d
      // these from their view in `FightStartService.startPvM` to keep
      // ghost roleplay sprites from bleeding into the fight overlay, so
      // we have to put them back when the fight ends or the map looks
      // empty until the player crosses an edge and re-enters.
      const worldEntries: SpriteMovementEntry[] = [];

      for (const otherPlayer of this.presence.onMap(presence.mapId)) {
        if (otherPlayer.characterId !== presence.characterId) {
          worldEntries.push(
            toSpriteEntry(otherPlayer, SpriteMovementEntry_Operation.ADD)
          );
        }
      }

      for (const liveGroup of this.mapMonsters.groupsOnMap(presence.mapId)) {
        worldEntries.push(monsterGroupToSpriteEntry(liveGroup));
      }

      if (worldEntries.length > 0) {
        this.frames.broadcast(
          [fighter.sessionId],
          create(DofusMessageSchema, {
            payload: {
              case: "gameMovement",
              value: create(GameMovementSchema, { entries: worldEntries }),
            },
          })
        );
      }
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
