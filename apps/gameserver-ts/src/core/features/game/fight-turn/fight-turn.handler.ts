import type { Fight } from "@modules/fight/core/fight.entity";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import {
  ActionAPChangeSchema,
  ActionMovementSchema,
  ActionMPChangeSchema,
  ActionSpellLaunchSchema,
  type GameActionRequest,
  GameActionRequestSchema,
  GameActionSchema,
  GameActionType,
  type GameTurnEnd,
  GameTurnEndSchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { CastSpellUseCase } from "@modules/fight/cast/fight.cast";
import { ActiveState } from "@modules/fight/core/fight.active-state";
import { EffectRegistry } from "@modules/fight/effects/fight.effect-registry";
import { FightEndService } from "@modules/fight/engine/fight.end.service";
import { FightFrameEmitter } from "@modules/fight/engine/fight.frame-emitter";
import { StateName } from "@modules/fight/fight.types";
import { distance } from "@modules/fight/map/fight.area";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { decodePath } from "@modules/maps/maps.path-codec";
import { SpellsService } from "@modules/spells/spells.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class FightTurnHandler {
  private readonly logger = new Logger(FightTurnHandler.name);
  private castSpell: CastSpellUseCase;

  constructor(
    readonly _sessions: SessionRegistry,
    private readonly frames: GatewayFrameService,
    private readonly fightRegistry: FightRegistryService,
    private readonly fightEnd: FightEndService,
    private readonly spells: SpellsService,
    private readonly effectRegistry: EffectRegistry,
    private readonly frameEmitter: FightFrameEmitter
  ) {
    this.castSpell = new CastSpellUseCase(
      {
        bySession: (sessionId: string) =>
          this.fightRegistry.getBySession(sessionId),
      },
      this.spells,
      this.effectRegistry,
      this.frameEmitter
    );
  }

  private broadcastToFight(
    fight: Fight,
    message: ReturnType<typeof create<typeof DofusMessageSchema>>
  ): void {
    this.frames.broadcast(fight.allSessions(), message);
  }

  @MessageHandler(GameTurnEndSchema)
  handleTurnEnd(ctx: HandlerContext, _msg: GameTurnEnd): void {
    const fight = this.fightRegistry.getBySession(ctx.sessionId);
    if (!fight || fight.state.name !== StateName.Active) {
      return;
    }

    const fighter = fight.fighters().find((f) => f.sessionId === ctx.sessionId);
    if (!fighter) {
      return;
    }

    const runner = this.fightRegistry.getRunner(fight.id);
    if (!runner) {
      return;
    }

    runner.requestEnd(fighter.id);
  }

  @MessageHandler(GameActionRequestSchema)
  async handleSpellCast(
    ctx: HandlerContext,
    msg: GameActionRequest
  ): Promise<void> {
    // Only handle spell cast actions (GA300) in fight context
    if (msg.actionType !== GameActionType.ACTION_SPELL_LAUNCH) {
      return;
    }

    const fight = this.fightRegistry.getBySession(ctx.sessionId);
    if (!fight || fight.state.name !== StateName.Active) {
      return;
    }

    // Check for close combat (weapon attack) with spellId=0
    const parts = msg.params.split(";");
    const spellId = Number.parseInt(parts[0] ?? "", 10);

    if (spellId === 0) {
      await this.handleCloseCombat(ctx, fight, msg.params);
      return;
    }

    try {
      const result = await this.castSpell.execute(ctx.sessionId, msg.params);

      const targets = fight
        .fighters()
        .filter((f) => f.sessionId)
        .map((f) => f.sessionId as string);

      // Need the spell row up front to get the visual gfx id for the
      // GA;300 broadcast and the AP cost for the GA;102 broadcast.
      const spell = await this.spells.spellLevel(result.spellId, result.level);

      // GA;300 — Spell cast animation
      this.frames.broadcast(
        targets,
        create(DofusMessageSchema, {
          payload: {
            case: "gameAction",
            value: create(GameActionSchema, {
              sequenceId: 300,
              actionType: GameActionType.ACTION_SPELL_LAUNCH,
              spriteId: String(result.caster.id),
              actionData: {
                case: "spellLaunch",
                value: create(ActionSpellLaunchSchema, {
                  spellId: result.spellId,
                  cellId: result.targetCell,
                  elementId: 0,
                  // param3 carries the visual gfx id — the SWF/dofasset
                  // filename the client must load. Mirrors Hetwan's
                  // GA;300 `visual` field. Multiple gameplay spells
                  // routinely share one gfx file (StarLoco sorts.sprite).
                  // Falls back to spellId when the spell row is missing
                  // (shouldn't happen in practice but keeps the wire safe).
                  param3: spell?.visualGfxId ?? result.spellId,
                  customSprite: -1,
                  // CAST pose key — clients map "anim1" to PlayerAnimation.CAST.
                  // The original Dofus 1.29 protocol always sends a string here.
                  animation: "anim1",
                }),
              },
            }),
          },
        })
      );

      // GA;102 — AP cost
      if (spell) {
        this.frames.broadcast(
          targets,
          create(DofusMessageSchema, {
            payload: {
              case: "gameAction",
              value: create(GameActionSchema, {
                sequenceId: 102,
                actionType: 102,
                spriteId: String(result.caster.id),
                actionData: {
                  case: "apChange",
                  value: create(ActionAPChangeSchema, {
                    spriteId: String(result.caster.id),
                    delta: -spell.apCost,
                    used: spell.apCost,
                  }),
                },
              }),
            },
          })
        );
      }

      this.logger.debug(
        `Spell cast fight=${fight.id} caster=${result.caster.id} spell=${result.spellId} cell=${result.targetCell} critical=${result.critical} failure=${result.failure}`
      );

      const endCheck = fight.checkFightEnd();
      if (endCheck.ended) {
        const runner = this.fightRegistry.getRunner(fight.id);
        if (runner) {
          runner.stop();
        }
        await this.fightEnd.endFight(fight);
      }
    } catch (err) {
      this.logger.debug(
        `Spell cast failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  private async handleCloseCombat(
    ctx: HandlerContext,
    fight: Fight,
    params: string
  ): Promise<void> {
    const fighter = fight.fighters().find((f) => f.sessionId === ctx.sessionId);
    if (!fighter) {
      return;
    }

    const parts = params.split(";");
    const cellId = Number.parseInt(parts[1] ?? "", 10);
    if (Number.isNaN(cellId)) {
      return;
    }

    // Check it's this fighter's turn
    const active = fight.state as ActiveState;
    const current = active.turnList.current();
    if (!current || current.id !== fighter.id) {
      return;
    }

    // Check AP (weapon costs 4 AP by default)
    const apCost = 4;
    if (fighter.ap < apCost) {
      return;
    }

    // Check range (melee = distance 1)
    const d = distance(fight.fightMap, fighter.cell, cellId);
    if (d > 1) {
      return;
    }

    // Find target on cell
    const target = fight.fighters().find((f) => !f.dead && f.cell === cellId);
    if (!target) {
      return;
    }

    // Deduct AP
    fighter.spendAp(apCost);

    // Calculate damage (simplified: Strength-based neutral damage)
    const str = fighter.stats.get(10) ?? 0; // Characteristic.Strength = 10
    const baseDmg = 5 + Math.floor(Math.random() * 5); // 5-9 base
    const damage = Math.max(1, Math.floor(baseDmg * ((100 + str) / 100)));

    // Apply damage
    target.setLp(target.lp - damage);
    fighter.damageDealt += damage;
    target.damageTaken += damage;

    // Broadcast damage
    this.frameEmitter.emitDamage(fight, fighter.id, target.id, damage, 0); // Element.Neutral = 0

    // Broadcast AP cost
    this.broadcastToFight(
      fight,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 102,
            actionType: 102,
            spriteId: String(fighter.id),
            actionData: {
              case: "apChange",
              value: create(ActionAPChangeSchema, {
                spriteId: String(fighter.id),
                delta: -apCost,
                used: apCost,
              }),
            },
          }),
        },
      })
    );

    this.logger.debug(
      `Close combat fight=${fight.id} attacker=${fighter.id} target=${target.id} damage=${damage}`
    );

    if (target.dead) {
      this.frameEmitter.emitDeath(fight, target.id);
      fight.modules.fireFighterDied(fight, target);

      const endCheck = fight.checkFightEnd();
      if (endCheck.ended) {
        const runner = this.fightRegistry.getRunner(fight.id);
        runner?.stop();
        await this.fightEnd.endFight(fight);
      }
    }
  }

  @MessageHandler(GameActionRequestSchema)
  handleFightMovement(ctx: HandlerContext, msg: GameActionRequest): void {
    if (msg.actionType !== GameActionType.ACTION_MOVEMENT) {
      return;
    }

    const fight = this.fightRegistry.getBySession(ctx.sessionId);
    if (!fight || fight.state.name !== StateName.Active) {
      return;
    }

    const fighter = fight.fighters().find((f) => f.sessionId === ctx.sessionId);
    if (!fighter) {
      return;
    }

    const runner = this.fightRegistry.getRunner(fight.id);
    if (!runner) {
      return;
    }

    const active = fight.state as ActiveState;
    const current = active.turnList.current();
    if (!current || current.id !== fighter.id) {
      return;
    }

    let cells: number[];
    try {
      cells = decodePath(msg.params).map((s) => s.cell);
    } catch {
      this.logger.warn(`Invalid fight path encoding session=${ctx.sessionId}`);
      return;
    }
    if (cells.length === 0) {
      return;
    }

    const mpCost = cells.length;
    if (mpCost > fighter.mp) {
      return;
    }

    const endCell = cells[cells.length - 1];
    if (endCell === undefined) {
      return;
    }

    // Validate path: each step must be adjacent and free
    let prevCell = fighter.cell;
    for (const cell of cells) {
      if (distance(fight.fightMap, prevCell, cell) !== 1) {
        this.logger.warn(
          `Invalid fight movement: non-adjacent cell ${prevCell} → ${cell}`
        );
        return;
      }
      if (!fight.fightMap.isFree(cell)) {
        this.logger.warn(`Invalid fight movement: cell ${cell} is occupied`);
        return;
      }
      if (!fight.fightMap.isWalkable(cell)) {
        this.logger.warn(
          `Invalid fight movement: cell ${cell} is not walkable`
        );
        return;
      }
      prevCell = cell;
    }

    fight.fightMap.free(fighter.cell, fighter.id);
    fighter.cell = endCell;
    fight.fightMap.occupy(endCell, fighter.id);
    fighter.spendMp(mpCost);

    this.broadcastToFight(
      fight,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 1,
            actionType: GameActionType.ACTION_MOVEMENT,
            spriteId: String(fighter.id),
            actionData: {
              case: "movement",
              value: create(ActionMovementSchema, {
                pathCells: cells,
              }),
            },
          }),
        },
      })
    );

    // GA;129 — MP cost
    this.broadcastToFight(
      fight,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 129,
            actionType: 129,
            spriteId: String(fighter.id),
            actionData: {
              case: "mpChange",
              value: create(ActionMPChangeSchema, {
                spriteId: String(fighter.id),
                delta: -mpCost,
              }),
            },
          }),
        },
      })
    );

    fight.fightMap.fireArrivalTriggers(fight, fighter, endCell);
  }
}
