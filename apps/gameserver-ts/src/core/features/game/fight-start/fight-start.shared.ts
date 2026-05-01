import type { Fight } from "@modules/fight/core/fight.entity";
import type { Fighter } from "@modules/fight/core/fight.fighter";
import type { ComputedStats } from "@modules/stats/stats.service";
import type { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { create } from "@bufbuild/protobuf";
import {
  type CharacterColors,
  CharacterColorsSchema,
  SpriteType,
} from "@dofus/proto/common_pb";
import {
  GameCreateSchema,
  GameJoinSchema,
  GameMovementSchema,
  GamePositionStartSchema,
  SpriteMovementEntrySchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { Characteristic, FighterKind } from "@modules/fight/fight.types";
import { FightMap, parsePlacementCells } from "@modules/fight/map/fight.map";

/**
 * Build the protobuf `CharacterColors` payload for a fighter's
 * SpriteMovementEntry. Mirrors the in-world roleplay path
 * (`player-presence.sprite-entry.ts`) so the StringCourse portrait and
 * the in-fight tinted sprite share the same `[c1,c2,c3]` source. Monsters
 * carry their colours on the fighter's `monsterColor*` fields (set in
 * `fight-start.service.ts`); players carry them on `player.colorN`.
 * `-1` means "keep palette default" — the client's renderer maps that to
 * a per-zone skip via `buildColorsArg`.
 */
export function fighterColors(fighter: Fighter): CharacterColors {
  if (fighter.kind === FighterKind.Monster) {
    return create(CharacterColorsSchema, {
      color1: fighter.monsterColor1,
      color2: fighter.monsterColor2,
      color3: fighter.monsterColor3,
    });
  }
  return create(CharacterColorsSchema, {
    color1: fighter.player?.color1 ?? -1,
    color2: fighter.player?.color2 ?? -1,
    color3: fighter.player?.color3 ?? -1,
  });
}

export function createFightMap(
  mapWidth: number,
  mapHeight: number,
  places0: string,
  places1: string,
  walkableCells?: number[]
): FightMap | null {
  const team0Cells = parsePlacementCells(places0);
  const team1Cells = parsePlacementCells(places1);
  if (team0Cells.length === 0 || team1Cells.length === 0) {
    return null;
  }
  const fmap = new FightMap(mapWidth, mapHeight, team0Cells, team1Cells);
  if (walkableCells) {
    fmap.setWalkableCells(walkableCells);
  }
  return fmap;
}

export function applyEquipmentStats(
  fighter: Fighter,
  equipStats: ComputedStats
): void {
  fighter.stats.addItem(Characteristic.Strength, equipStats.strength ?? 0);
  fighter.stats.addItem(Characteristic.Vitality, equipStats.vitality ?? 0);
  fighter.stats.addItem(Characteristic.Wisdom, equipStats.wisdom ?? 0);
  fighter.stats.addItem(
    Characteristic.Intelligence,
    equipStats.intelligence ?? 0
  );
  fighter.stats.addItem(Characteristic.Chance, equipStats.chance ?? 0);
  fighter.stats.addItem(Characteristic.Agility, equipStats.agility ?? 0);
  fighter.stats.addItem(Characteristic.ActionPoints, equipStats.ap ?? 0);
  fighter.stats.addItem(Characteristic.MovementPoints, equipStats.mp ?? 0);
  fighter.stats.addItem(Characteristic.Range, equipStats.range ?? 0);
  fighter.stats.addItem(Characteristic.MaxSummons, equipStats.summons ?? 0);
  fighter.stats.addItem(
    Characteristic.DamageBonus,
    equipStats.damageBonus ?? 0
  );
  fighter.stats.addItem(
    Characteristic.DamagePercent,
    equipStats.damagePct ?? 0
  );
  fighter.stats.addItem(Characteristic.HealBonus, equipStats.healBonus ?? 0);
  fighter.stats.addItem(
    Characteristic.CriticalHit,
    equipStats.criticalHit ?? 0
  );
  fighter.stats.addItem(Characteristic.DodgeAP, equipStats.dodgeAp ?? 0);
  fighter.stats.addItem(Characteristic.DodgeMP, equipStats.dodgeMp ?? 0);
  fighter.stats.addItem(
    Characteristic.ResistNeutral,
    equipStats.resistNeutral ?? 0
  );
  fighter.stats.addItem(
    Characteristic.ResistNeutralPct,
    equipStats.resistNeutralPct ?? 0
  );
  fighter.stats.addItem(
    Characteristic.ResistEarth,
    equipStats.resistEarth ?? 0
  );
  fighter.stats.addItem(
    Characteristic.ResistEarthPct,
    equipStats.resistEarthPct ?? 0
  );
  fighter.stats.addItem(
    Characteristic.ResistWater,
    equipStats.resistWater ?? 0
  );
  fighter.stats.addItem(
    Characteristic.ResistWaterPct,
    equipStats.resistWaterPct ?? 0
  );
  fighter.stats.addItem(Characteristic.ResistAir, equipStats.resistAir ?? 0);
  fighter.stats.addItem(
    Characteristic.ResistAirPct,
    equipStats.resistAirPct ?? 0
  );
  fighter.stats.addItem(Characteristic.ResistFire, equipStats.resistFire ?? 0);
  fighter.stats.addItem(
    Characteristic.ResistFirePct,
    equipStats.resistFirePct ?? 0
  );
}

export function emitJoinFrames(
  frames: GatewayFrameService,
  sessionId: string,
  fight: Fight,
  playerFighter: Fighter,
  opponents: Fighter[]
): void {
  frames.broadcast(
    [sessionId],
    create(DofusMessageSchema, {
      payload: {
        case: "gameCreate",
        value: create(GameCreateSchema, {
          success: true,
          state: fight.type,
        }),
      },
    })
  );

  frames.broadcast(
    [sessionId],
    create(DofusMessageSchema, {
      payload: {
        case: "gameJoin",
        value: create(GameJoinSchema, {
          state: 2,
          hasCancel: false,
          hasChallenge: false,
          isSpectator: false,
          timerMs: 45000,
          fightType: fight.type,
        }),
      },
    })
  );

  frames.broadcast(
    [sessionId],
    create(DofusMessageSchema, {
      payload: {
        case: "gamePositionStart",
        value: create(GamePositionStartSchema, {
          team1Cells: fight.fightMap.teamCells[0],
          team2Cells: fight.fightMap.teamCells[1],
          currentTeam: playerFighter.team?.side ?? 0,
        }),
      },
    })
  );

  const allFighters = [playerFighter, ...opponents];
  const entries = allFighters.map((m) =>
    create(SpriteMovementEntrySchema, {
      operation: 0,
      spriteType:
        m.kind === FighterKind.Monster
          ? SpriteType.MONSTER
          : SpriteType.CHARACTER,
      spriteId: String(m.id),
      cellId: m.cell,
      direction: m.direction,
      gfxId:
        m.kind === FighterKind.Monster ? m.monsterGfx : (m.player?.gfx ?? 0),
      scaleX: 100,
      scaleY: 100,
      name: m.name,
      team: m.team?.side ?? 0,
      lp: m.lp,
      lpMax: m.lpMax,
      ap: m.ap,
      mp: m.mp,
      level: m.level,
      colors: fighterColors(m),
    })
  );

  frames.broadcast(
    [sessionId],
    create(DofusMessageSchema, {
      payload: {
        case: "gameMovement",
        value: create(GameMovementSchema, { entries }),
      },
    })
  );
}

export function removeSpritesFromMap(
  frames: GatewayFrameService,
  presence: { sessionsOnMap(mapId: number, exceptCharId?: string): string[] },
  mapId: number,
  characterId: string,
  monsterSpriteId?: string
): void {
  const mapSessions = presence.sessionsOnMap(mapId, characterId);
  if (mapSessions.length === 0) {
    return;
  }

  const entries = [
    create(SpriteMovementEntrySchema, {
      operation: 2, // REMOVE
      spriteId: characterId,
    }),
  ];

  if (monsterSpriteId) {
    entries.push(
      create(SpriteMovementEntrySchema, {
        operation: 2, // REMOVE
        spriteId: monsterSpriteId,
      })
    );
  }

  frames.broadcast(
    mapSessions,
    create(DofusMessageSchema, {
      payload: {
        case: "gameMovement",
        value: create(GameMovementSchema, { entries }),
      },
    })
  );
}
