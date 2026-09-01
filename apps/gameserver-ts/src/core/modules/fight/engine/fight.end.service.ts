import type { FightChallenge } from "@modules/fight/challenges/fight.challenge.base";
import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { LootRoll } from "@modules/fight/engine/fight.loot";
import type { ExperienceGain } from "@modules/jobs/jobs.service";
import type { TransactionalAdapterKysely } from "@nestjs-cls/transactional-adapter-kysely";
import type { DB } from "@shared/db/schema";
import { create } from "@bufbuild/protobuf";
import {
  FightItemDropSchema,
  FightResultSchema,
  GameEndSchema,
  GameMovementSchema,
  type SpriteMovementEntry,
  SpriteMovementEntry_Operation,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { SpellListSchema } from "@dofus/proto/spells_pb";
import { FightHistoryRepository } from "@modules/fight/engine/fight.history.repository";
import { rollLoot } from "@modules/fight/engine/fight.loot";
import {
  Characteristic,
  FightType,
  type TeamSide,
} from "@modules/fight/fight.types";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { InventoryFramesService } from "@modules/inventory/inventory.frames.service";
import { InventoryRepository } from "@modules/inventory/inventory.repository";
import {
  parseItemEffects,
  rollItemEffects,
} from "@modules/inventory/item-effects";
import {
  HUNTER_JOB_ID,
  HUNTING_WEAPON_EFFECT_ID,
  RAW_MEAT_ITEM_TYPE,
  rollHunterMeat,
} from "@modules/jobs/hunter.rules";
import { JobsRepository } from "@modules/jobs/jobs.repository";
import { JobsService } from "@modules/jobs/jobs.service";
import { MapTransitionService } from "@modules/maps/maps.transition.service";
import { MapMonsterService } from "@modules/monsters/map-monster.service";
import { monsterGroupToSpriteEntry } from "@modules/monsters/map-monster.sprite-entry";
import { MonstersRepository } from "@modules/monsters/monsters.repository";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { toSpriteEntry } from "@modules/player-presence/player-presence.sprite-entry";
import { PlayersProgressionService } from "@modules/players/players.progression.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { SpellsService } from "@modules/spells/spells.service";
import { prospection } from "@modules/stats/stats.constants";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { TransactionHost } from "@nestjs-cls/transactional";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/** One winner that crossed a level threshold, and what to re-push to it. */
interface LevelUpOutcome {
  sessionId: string;
  playerId: string;
  learnedSpells: number;
}

interface HunterGainOutcome {
  sessionId: string;
  playerId: string;
  gain: ExperienceGain;
}

interface RolledRewards {
  loot: Map<number, LootRoll[]>;
  hunterExperience: Map<number, number>;
}

@Injectable()
export class FightEndService {
  private readonly logger = new Logger(FightEndService.name);

  constructor(
    private readonly registry: FightRegistryService,
    private readonly frames: GatewayFrameService,
    private readonly historyRepo: FightHistoryRepository,
    private readonly players: PlayersRepository,
    private readonly progression: PlayersProgressionService,
    private readonly spells: SpellsService,
    private readonly stats: StatsService,
    private readonly presence: PlayerPresenceService,
    private readonly transition: MapTransitionService,
    private readonly mapMonsters: MapMonsterService,
    private readonly monsters: MonstersRepository,
    private readonly inventory: InventoryRepository,
    private readonly items: InventoryFramesService,
    private readonly jobsRepo: JobsRepository,
    private readonly jobs: JobsService,
    private readonly txHost: TransactionHost<TransactionalAdapterKysely<DB>>
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

    const { loot, hunterExperience } = await this.rollLoot(
      fight,
      winner,
      winnerPlayers,
      challengeDropBonus
    );

    // Persist BEFORE broadcasting. The end-of-fight screen is the only
    // place a player ever sees their reward, so a screen that shows a
    // payout the database never took is the worst possible failure here:
    // the player believes they earned it. Writing first means a failed
    // transaction shows nothing rather than a lie.
    const { levelledUp, hunterGains } = await this.persistOutcome({
      fight,
      winner,
      durationMs,
      xpPerPlayer,
      kamasPerPlayer,
      loot,
      hunterExperience,
    });

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
        itemsWon: (loot.get(f.id) ?? []).map((won) =>
          create(FightItemDropSchema, {
            itemId: won.templateId,
            quantity: won.quantity,
          })
        ),
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

    // After the result screen, so the panels the player opens next are
    // already showing the new level, capital and spells.
    await this.announceLevelUps(levelledUp);
    await this.announceHunterGains(hunterGains);

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

  /**
   * Roll each winner's loot from the drop tables of the monsters they
   * defeated, keyed by winning fighter id.
   *
   * Nothing had ever read `monster_drops` before QA-060 — the table was
   * imported (4 562 rows) and never queried. The whole team's drop table
   * is fetched in one round-trip, then every winner rolls it
   * independently, each with their own prospection: that is the 1.29
   * behaviour, where two players in a group can walk out of the same
   * fight with different loot.
   *
   * PvM only. A duel or a challenge fight drops nothing.
   */
  private async rollLoot(
    fight: Fight,
    winner: TeamSide,
    winnerPlayers: readonly Fighter[],
    challengeDropBonus: number
  ): Promise<RolledRewards> {
    const loot = new Map<number, LootRoll[]>();
    const hunterExperience = new Map<number, number>();

    if (fight.type !== FightType.PvM || winnerPlayers.length === 0) {
      return { loot, hunterExperience };
    }

    const loserTeam = winner === 0 ? 1 : 0;
    const monsterIds = fight.teams[loserTeam]
      .fighters()
      .map((f) => f.monsterTemplateId)
      .filter((id) => id > 0);

    if (monsterIds.length === 0) {
      return { loot, hunterExperience };
    }

    const drops = await this.monsters.dropsFor(monsterIds);

    if (drops.length === 0) {
      return { loot, hunterExperience };
    }

    // Raw meat is not ordinary loot. Without this split the generic roller
    // grants it to every character, including non-hunters and hunters with no
    // hunting weapon — exactly the opposite of the profession's one gate.
    const ordinaryDrops = drops.filter(
      (drop) => drop.itemType !== RAW_MEAT_ITEM_TYPE
    );

    for (const fighter of winnerPlayers) {
      if (!fighter.player) {
        continue;
      }

      // The fighter's Chance already carries base + equipment: fight
      // start folds the equipment stats in via `applyEquipmentStats`.
      // Reading it here rather than re-querying is both cheaper and more
      // honest — it is the chance the player actually fought with.
      const rolled = rollLoot({
        drops: ordinaryDrops,
        prospection: prospection(fighter.stats.get(Characteristic.Chance), 0),
        challengeBonusPct: challengeDropBonus,
      });

      const playerId = String(fighter.player.id);
      const hunter = await this.jobsRepo.findPlayerJob(playerId, HUNTER_JOB_ID);
      const huntingWeapon = hunter
        ? await this.hasHuntingWeapon(playerId)
        : false;
      const hunted = rollHunterMeat({
        hasHuntingWeapon: huntingWeapon,
        hunterLevel: hunter?.level ?? 0,
        monsterIds,
        drops,
        prospection: prospection(fighter.stats.get(Characteristic.Chance), 0),
      });

      rolled.push(...hunted.items);
      if (hunted.experience > 0) {
        hunterExperience.set(fighter.id, hunted.experience);
      }

      if (rolled.length > 0) {
        loot.set(fighter.id, rolled);
      }
    }

    return { loot, hunterExperience };
  }

  /** Native hunting tools and runed weapons both carry effect 795. */
  private async hasHuntingWeapon(playerId: string): Promise<boolean> {
    const weapon = (await this.inventory.findEquipped(playerId)).find(
      (item) => item.position === 1
    );

    if (!weapon) {
      return false;
    }

    let effects = parseItemEffects(weapon.effects);
    if (effects.length === 0) {
      const template = await this.inventory.findTemplate(weapon.templateId);
      effects = parseItemEffects(template?.effects);
    }

    return effects.some((effect) => effect.id === HUNTING_WEAPON_EFFECT_ID);
  }

  /**
   * Write the whole outcome — history, participants, experience, kamas
   * and loot — in a single transaction.
   *
   * The atomicity is the point: a fight that fails halfway must not
   * leave a player holding the items but not the experience, nor a
   * history row describing a payout that never happened. Before QA-060
   * these were four independent awaits with no transaction at all.
   */
  private async persistOutcome(outcome: {
    fight: Fight;
    winner: TeamSide;
    durationMs: number;
    xpPerPlayer: number;
    kamasPerPlayer: number;
    loot: Map<number, LootRoll[]>;
    hunterExperience: Map<number, number>;
  }): Promise<{
    levelledUp: LevelUpOutcome[];
    hunterGains: HunterGainOutcome[];
  }> {
    const {
      fight,
      winner,
      durationMs,
      xpPerPlayer,
      kamasPerPlayer,
      loot,
      hunterExperience,
    } = outcome;

    // Collected inside the transaction, announced outside it: a client
    // told "you reached level 12" by a transaction that then rolls back
    // is the same lie the payout screen is careful not to tell.
    const levelledUp: LevelUpOutcome[] = [];
    const hunterGains: HunterGainOutcome[] = [];

    await this.txHost.withTransaction(async () => {
      const historyResult = await this.historyRepo.insertHistory({
        type: fight.type,
        mapId: fight.mapId,
        startedAt: new Date(fight.startedAt),
        endedAt: new Date(),
        winnerTeam: winner,
        durationMs,
      });

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

        if (!fighter.player) {
          continue;
        }

        const playerId = String(fighter.player.id);

        // Persist the life the fighter walked out with — QA-070. Nothing
        // wrote `players.life` before this: combat damage never left
        // memory, so every character sat permanently at their seed value
        // and out-of-combat regeneration had nothing to regenerate. Both
        // sides get it, not just the winners: a losing team that
        // survived (a leaver, a timed-out fight) has taken real damage
        // too.
        //
        // A defeated player revives with a single point, the 1.29
        // convention, and is teleported to their savepoint further down.
        // The timestamp restarts here so regeneration is counted from
        // the end of the fight and not from whenever life was last read.
        await this.players.setLife(
          playerId,
          fighter.dead ? 1 : Math.max(1, fighter.lp),
          new Date()
        );

        if (!isWinner) {
          continue;
        }

        await this.players.addXpAndKamas(playerId, xpGained, kamasGained);

        // Every level the experience now covers, not just the first one,
        // plus the spells they unlock — see `PlayersProgressionService`.
        const progress = await this.progression.applyExperience(playerId);

        if (
          fighter.sessionId &&
          progress &&
          progress.level > progress.previousLevel
        ) {
          levelledUp.push({
            sessionId: fighter.sessionId,
            playerId,
            learnedSpells: progress.learnedSpellIds.length,
          });
        }

        await this.grantLoot(fighter, playerId, loot.get(fighter.id) ?? []);

        const hunterXp = hunterExperience.get(fighter.id) ?? 0;
        if (fighter.sessionId && hunterXp > 0) {
          const gain = await this.jobs.addExperience(
            playerId,
            HUNTER_JOB_ID,
            hunterXp
          );
          if (gain) {
            hunterGains.push({
              sessionId: fighter.sessionId,
              playerId,
              gain,
            });
          }
        }
      }
    });

    return { levelledUp, hunterGains };
  }

  private async announceHunterGains(
    hunterGains: readonly HunterGainOutcome[]
  ): Promise<void> {
    for (const entry of hunterGains) {
      await this.jobs.announceGain(entry.sessionId, entry.playerId, entry.gain);

      if (entry.gain.leveledTo !== null) {
        await this.stats.sendStats(entry.sessionId, entry.playerId);
      }
    }
  }

  /**
   * Tell a client that just levelled up what changed.
   *
   * A level up moves three things the HUD reads and none of them travel
   * on `GameEnd`: the spell book (new spells), the level/experience bar,
   * and the two point balances. `SpellList` is the same full-snapshot
   * frame `spell-upgrade` re-pushes for the same reason — the client
   * treats it as authoritative rather than merging.
   */
  private async announceLevelUps(levelledUp: LevelUpOutcome[]): Promise<void> {
    for (const entry of levelledUp) {
      if (entry.learnedSpells > 0) {
        const spellData = await this.spells.buildSpellList(entry.playerId);

        this.frames.broadcast(
          [entry.sessionId],
          create(DofusMessageSchema, {
            payload: {
              case: "spellList",
              value: create(SpellListSchema, { spells: spellData }),
            },
          })
        );
      }

      await this.stats.sendStats(entry.sessionId, entry.playerId);
    }
  }

  /**
   * Create one winner's items and tell their client about them.
   *
   * Each item rolls its own stats at creation (`rollItemEffects`) — a
   * template is a recipe, and two players looting the same template do
   * not get the same object. The `ItemAdd` frame is the project's first
   * `item*` emission; the client has had the handler and the store
   * wired up all along and simply never received one.
   */
  private async grantLoot(
    fighter: Fighter,
    playerId: string,
    won: readonly LootRoll[]
  ): Promise<void> {
    for (const roll of won) {
      const template = await this.inventory.findTemplate(roll.templateId);

      if (!template) {
        this.logger.warn(
          `loot: unknown item template ${roll.templateId}, skipped`
        );
        continue;
      }

      const row = await this.inventory.insertItem({
        playerId,
        templateId: roll.templateId,
        quantity: roll.quantity,
        effects: rollItemEffects(template.effects),
      });

      if (fighter.sessionId) {
        this.items.sendItemAdd(fighter.sessionId, row);
      }
    }
  }

  private detectWinner(fight: Fight): TeamSide {
    const alive0 = fight.teams[0].fighters().filter((f) => !f.dead).length;
    if (alive0 === 0) {
      return 1 as TeamSide;
    }
    return 0 as TeamSide;
  }
}
