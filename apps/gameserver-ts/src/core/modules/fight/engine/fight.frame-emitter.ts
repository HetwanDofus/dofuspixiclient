import type { Fight } from "@modules/fight/core/fight.entity";
import type { Buff } from "@modules/fight/effects/fight.buff";
import type { Emitter } from "@modules/fight/effects/fight.effect-registry.types";
import { create } from "@bufbuild/protobuf";
import {
  ActionAPChangeSchema,
  ActionDamageSchema,
  ActionDeathSchema,
  ActionGlyphSchema,
  ActionMovementSchema,
  ActionMPChangeSchema,
  ActionSpritePositionSchema,
  GameActionSchema,
  GameActionType,
  GameZoneData_Operation,
  GameZoneDataSchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { Injectable } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

@Injectable()
export class FightFrameEmitter implements Emitter {
  constructor(private readonly frames: GatewayFrameService) {}

  private targets(fight: Fight): string[] {
    return fight.allSessions();
  }

  emitDamage(
    fight: Fight,
    attackerId: number,
    targetId: number,
    amount: number,
    element: number
  ): void {
    const elementActionId =
      element === 1
        ? 96
        : element === 2
          ? 97
          : element === 3
            ? 98
            : element === 4
              ? 99
              : 100;

    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: elementActionId,
            actionType: elementActionId,
            spriteId: String(attackerId),
            actionData: {
              case: "damage",
              value: create(ActionDamageSchema, {
                spriteId: String(targetId),
                amount,
                element,
              }),
            },
          }),
        },
      })
    );
  }

  emitHeal(
    fight: Fight,
    healerId: number,
    targetId: number,
    amount: number
  ): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 108,
            actionType: 108,
            spriteId: String(healerId),
            actionData: {
              case: "damage",
              value: create(ActionDamageSchema, {
                spriteId: String(targetId),
                amount,
                element: 0,
              }),
            },
          }),
        },
      })
    );
  }

  emitDeath(fight: Fight, targetId: number): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 103,
            actionType: 103,
            spriteId: String(targetId),
            actionData: {
              case: "death",
              value: create(ActionDeathSchema, {
                spriteId: String(targetId),
              }),
            },
          }),
        },
      })
    );
  }

  emitAPLoss(
    fight: Fight,
    attackerId: number,
    targetId: number,
    amount: number
  ): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 102,
            actionType: 102,
            spriteId: String(attackerId),
            actionData: {
              case: "apChange",
              value: create(ActionAPChangeSchema, {
                spriteId: String(targetId),
                delta: -amount,
                used: amount,
              }),
            },
          }),
        },
      })
    );
  }

  emitMPLoss(
    fight: Fight,
    attackerId: number,
    targetId: number,
    amount: number
  ): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 127,
            actionType: 127,
            spriteId: String(attackerId),
            actionData: {
              case: "mpChange",
              value: create(ActionMPChangeSchema, {
                spriteId: String(targetId),
                delta: -amount,
              }),
            },
          }),
        },
      })
    );
  }

  emitBuff(fight: Fight, casterId: number, targetId: number, buff: Buff): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: buff.effectId,
            actionType: buff.effectId,
            spriteId: String(casterId),
            rawParams: `${targetId},${buff.value},${buff.remaining}`,
          }),
        },
      })
    );
  }

  emitTeleport(
    fight: Fight,
    targetId: number,
    _fromCell: number,
    toCell: number
  ): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 4,
            actionType: 4,
            spriteId: String(targetId),
            actionData: {
              case: "spritePosition",
              value: create(ActionSpritePositionSchema, {
                spriteId: String(targetId),
                cellId: toCell,
              }),
            },
          }),
        },
      })
    );
  }

  private emitZone(
    fight: Fight,
    operation: GameZoneData_Operation,
    cell: number,
    size: number,
    color: number,
    areaKind: number
  ): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameZoneData",
          value: create(GameZoneDataSchema, {
            operation,
            cellId: cell,
            size,
            color,
            areaKind,
          }),
        },
      })
    );
  }

  emitTrapAdd(
    fight: Fight,
    _casterId: number,
    cell: number,
    size: number,
    color: number,
    areaKind: number
  ): void {
    this.emitZone(
      fight,
      GameZoneData_Operation.ADD,
      cell,
      size,
      color,
      areaKind
    );
  }

  emitGlyphAdd(
    fight: Fight,
    _casterId: number,
    cell: number,
    size: number,
    color: number,
    areaKind: number
  ): void {
    this.emitZone(
      fight,
      GameZoneData_Operation.ADD,
      cell,
      size,
      color,
      areaKind
    );
  }

  emitTrapRemove(fight: Fight, cell: number): void {
    this.emitZone(fight, GameZoneData_Operation.REMOVE, cell, 0, 0, 0);
  }

  emitGlyphRemove(fight: Fight, cell: number): void {
    this.emitZone(fight, GameZoneData_Operation.REMOVE, cell, 0, 0, 0);
  }

  emitGlyphTrigger(
    fight: Fight,
    casterId: number,
    cell: number,
    spellId: number
  ): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: GameActionType.ACTION_GLYPH_EFFECT,
            actionType: GameActionType.ACTION_GLYPH_EFFECT,
            spriteId: String(casterId),
            actionData: {
              case: "glyph",
              value: create(ActionGlyphSchema, {
                spriteId: String(casterId),
                cellId: cell,
                param1: spellId,
              }),
            },
          }),
        },
      })
    );
  }

  emitMovement(fight: Fight, fighterId: number, pathCells: number[]): void {
    this.frames.broadcast(
      this.targets(fight),
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 1,
            actionType: GameActionType.ACTION_MOVEMENT,
            spriteId: String(fighterId),
            actionData: {
              case: "movement",
              value: create(ActionMovementSchema, { pathCells }),
            },
          }),
        },
      })
    );
  }
}
