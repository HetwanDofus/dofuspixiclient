import type { MonsterSpell } from "@modules/fight/cast/fight.spell.types";
import type { PlayerPresenceEntry } from "@modules/player-presence/player-presence.service";
import { create } from "@bufbuild/protobuf";
import {
  GameMovementSchema,
  type SpriteMovementEntry,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { FightChallengeService } from "@modules/fight/challenges/fight.challenge.service";
import { Fight } from "@modules/fight/core/fight.entity";
import { Fighter } from "@modules/fight/core/fight.fighter";
import {
  InitialiseState,
  PlacementState,
} from "@modules/fight/core/fight.states";
import { FighterKind, FightType, TeamSide } from "@modules/fight/fight.types";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { MapMonsterService } from "@modules/monsters/map-monster.service";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import { PlayersRepository } from "@modules/players/players.repository";
import { SpellsRepository } from "@modules/spells/spells.repository";
import { maxLifePoints } from "@modules/stats/stats.constants";
import { StatsService } from "@modules/stats/stats.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

import {
  applyEquipmentStats,
  createFightMap,
  emitJoinFrames,
  removeSpritesFromMap,
} from "./fight-start.shared";

export interface MonsterGroupInfo {
  groupId: number;
  mapId: number;
  cellId: number;
  members: Array<{
    templateId: number;
    name: string;
    gfx: number;
    level: number;
    life: number;
    ap: number;
    mp: number;
    color1: number;
    color2: number;
    color3: number;
    spells?: Array<{ id?: number; spellId?: number; level?: number }>;
  }>;
}

@Injectable()
export class FightStartService {
  private readonly logger = new Logger(FightStartService.name);

  // Monotonically-decrementing counter for monster fighter IDs. Starts far
  // below the small negative range used by `MapMonsterService.nextGroupId`
  // (which begins at -1) so a monster fighter id can never collide with a
  // live monster group's world-actor id. Sequential allocation also
  // eliminates the birthday-paradox collisions the previous
  // `groupId * 1000 + Math.random() * 1000` scheme produced (~3% per fight
  // for 8-mob groups), which surfaced as two fighters sharing one spriteId
  // and the client's `Map<spriteId, fighter>` collapsing to a single slot.
  private nextMonsterFighterId = -1_000_000;

  constructor(
    private readonly registry: FightRegistryService,
    private readonly frames: GatewayFrameService,
    private readonly players: PlayersRepository,
    private readonly spells: SpellsRepository,
    private readonly challenges: FightChallengeService,
    private readonly presence: PlayerPresenceService,
    private readonly stats: StatsService,
    private readonly mapMonsters: MapMonsterService
  ) {}

  async startPvM(
    sessionId: string,
    player: PlayerPresenceEntry,
    mapWidth: number,
    mapHeight: number,
    places0: string,
    places1: string,
    group: MonsterGroupInfo,
    walkableCells?: number[]
  ): Promise<Fight | null> {
    if (this.registry.isInFight(sessionId)) {
      this.logger.warn(`Player already in fight sessionId=${sessionId}`);
      return null;
    }

    const fightMap = createFightMap(
      mapWidth,
      mapHeight,
      places0,
      places1,
      walkableCells
    );
    if (!fightMap) {
      this.logger.warn(`Invalid placement cells mapId=${group.mapId}`);
      return null;
    }

    const fight = new Fight(FightType.PvM, group.mapId, fightMap, [
      { side: TeamSide.Side0, leaderId: Number(player.characterId) },
      { side: TeamSide.Side1, leaderId: group.groupId },
    ]);

    const playerFighter = await this.loadPlayerFighter(sessionId, player);
    if (!playerFighter) {
      this.logger.warn(
        `Player data not found characterId=${player.characterId}`
      );
      return null;
    }

    fight.teams[0].add(playerFighter);
    this.addMonsters(fight, group);

    this.registry.add(fight);
    fight.transition(new InitialiseState(() => this.onFightReady(fight)));
    fight.transition(new PlacementState());

    for (const fighter of fight.teams[1].fighters()) {
      fighter.ready = true;
    }

    await this.challenges.assignChallenges(fight);

    const groupSpriteId = String(group.groupId);

    // Hide every roleplay sprite on the player's map before entering
    // fight mode — the engaged group, every OTHER monster group still on
    // the map, and every other player. Without this, those sprites stay
    // rendered through the fight: the renderer reuses the world-actors
    // layer for fighters (battlefield-scene.ts:setFightMode) and pulls
    // their team from `SpriteMovementEntry.team`, which proto3 defaults
    // to 0 when not set during roleplay. Result: every leftover sprite
    // pops a player-team ground ring at its random spawn cell the moment
    // combat starts, producing ghost "duplicate" mobs scattered across
    // non-placement cells. Canonical 1.29 hides the world layer entirely
    // during a fight; we approximate by REMOVE-ing the sprites server-
    // side and re-ADDing them in `FightEndService.endFight`.
    const hideEntries: SpriteMovementEntry[] = [
      create(SpriteMovementEntrySchema, {
        operation: 2, // REMOVE
        spriteId: groupSpriteId,
      }),
    ];

    for (const otherGroup of this.mapMonsters.groupsOnMap(group.mapId)) {
      if (otherGroup.id !== group.groupId) {
        hideEntries.push(
          create(SpriteMovementEntrySchema, {
            operation: 2, // REMOVE
            spriteId: String(otherGroup.id),
          })
        );
      }
    }

    for (const otherPlayer of this.presence.onMap(group.mapId)) {
      if (otherPlayer.characterId !== player.characterId) {
        hideEntries.push(
          create(SpriteMovementEntrySchema, {
            operation: 2, // REMOVE
            spriteId: otherPlayer.characterId,
          })
        );
      }
    }

    this.frames.broadcast(
      [sessionId],
      create(DofusMessageSchema, {
        payload: {
          case: "gameMovement",
          value: create(GameMovementSchema, { entries: hideEntries }),
        },
      })
    );

    const monsterFighters = fight.teams[1].fighters();
    emitJoinFrames(
      this.frames,
      sessionId,
      fight,
      playerFighter,
      monsterFighters
    );
    removeSpritesFromMap(
      this.frames,
      this.presence,
      group.mapId,
      String(Number(player.characterId)),
      groupSpriteId
    );

    return fight;
  }

  async startChallenge(
    sessionIdA: string,
    sessionIdB: string,
    playerA: PlayerPresenceEntry,
    playerB: PlayerPresenceEntry,
    mapWidth: number,
    mapHeight: number,
    places0: string,
    places1: string
  ): Promise<Fight | null> {
    if (
      this.registry.isInFight(sessionIdA) ||
      this.registry.isInFight(sessionIdB)
    ) {
      this.logger.warn(
        `One player already in fight sessionIdA=${sessionIdA} sessionIdB=${sessionIdB}`
      );
      return null;
    }

    const fightMap = createFightMap(mapWidth, mapHeight, places0, places1);
    if (!fightMap) {
      this.logger.warn(
        `Invalid placement cells for challenge mapId=${playerA.mapId}`
      );
      return null;
    }

    const fight = new Fight(FightType.Challenge, playerA.mapId, fightMap, [
      { side: TeamSide.Side0, leaderId: Number(playerA.characterId) },
      { side: TeamSide.Side1, leaderId: Number(playerB.characterId) },
    ]);

    const fighterA = await this.loadPlayerFighter(sessionIdA, playerA);
    const fighterB = await this.loadPlayerFighter(sessionIdB, playerB);

    if (!fighterA || !fighterB) {
      this.logger.warn(`Challenge: player data not found`);
      return null;
    }

    fight.teams[0].add(fighterA);
    fight.teams[1].add(fighterB);

    this.registry.add(fight);
    fight.transition(new InitialiseState());
    fight.transition(new PlacementState());

    emitJoinFrames(this.frames, sessionIdA, fight, fighterA, [fighterB]);
    emitJoinFrames(this.frames, sessionIdB, fight, fighterB, [fighterA]);

    return fight;
  }

  private async loadPlayerFighter(
    sessionId: string,
    player: PlayerPresenceEntry
  ): Promise<Fighter | null> {
    const playerData = await this.players.findById(player.characterId);
    if (!playerData) {
      return null;
    }

    const equipStats = await this.stats.computeEquipmentStats(
      player.characterId
    );
    const playerStats = await this.players.findStats(player.characterId);
    await this.players.loadPresence(player.characterId);

    // Derive the cap rather than reading `playerData.life`: that column
    // stores CURRENT life, so a player walking into the fight at
    // 200/1050 would spawn as 200/200 and cap at the wrong ceiling for
    // the rest of the fight.
    const totalVit = (playerStats?.vitality ?? 0) + (equipStats.vitality ?? 0);
    const lifeMax = maxLifePoints(playerData.level, totalVit);

    const fighter = Fighter.fromPlayer(sessionId, {
      id: Number(player.characterId),
      name: player.name,
      level: playerData.level,
      life: playerData.life,
      lifeMax,
      direction: player.direction,
      sex: playerData.sex,
      gfx: playerData.gfx,
      color1: player.color1,
      color2: player.color2,
      color3: player.color3,
      stats: {
        strength: playerStats?.strength ?? 0,
        vitality: playerStats?.vitality ?? 0,
        wisdom: playerStats?.wisdom ?? 0,
        intelligence: playerStats?.intelligence ?? 0,
        chance: playerStats?.chance ?? 0,
        agility: playerStats?.agility ?? 0,
      },
    });

    applyEquipmentStats(fighter, equipStats);
    return fighter;
  }

  private addMonsters(fight: Fight, group: MonsterGroupInfo): void {
    for (const member of group.members) {
      const monsterId = this.nextMonsterFighterId--;
      const monsterFighter = new Fighter(
        monsterId,
        FighterKind.Monster,
        member.name,
        member.life,
        member.ap,
        member.mp,
        0
      );

      monsterFighter.monsterTemplateId = member.templateId;
      monsterFighter.monsterGfx = member.gfx;
      monsterFighter.monsterLevel = member.level;
      monsterFighter.monsterColor1 = member.color1;
      monsterFighter.monsterColor2 = member.color2;
      monsterFighter.monsterColor3 = member.color3;

      if (member.spells) {
        const loadedSpells: MonsterSpell[] = [];
        for (const spellRef of member.spells) {
          const spellId = spellRef.spellId ?? spellRef.id;
          const spellLevel = spellRef.level ?? 1;
          if (spellId) {
            loadedSpells.push({
              spellId,
              level: spellLevel,
            });
          }
        }
        monsterFighter.monsterSpells = loadedSpells;
      }

      fight.teams[1].add(monsterFighter);
    }
  }

  private onFightReady(fight: Fight): void {
    this.logger.debug(`Fight ${fight.id} ready, type=${fight.type}`);
  }
}
