import type { Fight } from "@modules/fight/core/fight.entity";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { create } from "@bufbuild/protobuf";
import { clampFightDirection, getDirection } from "@dofus/grid";
import {
  ActionAPChangeSchema,
  ActionDirectionChangeSchema,
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
      // Phase 1 — validate + roll critical/failure WITHOUT mutating
      // fighter state and WITHOUT emitting damage GAs. If validation
      // throws, no client-visible side effect occurs.
      const resolution = await this.castSpell.resolve(
        ctx.sessionId,
        msg.params
      );

      const targets = fight
        .fighters()
        .filter((f) => f.sessionId)
        .map((f) => f.sessionId as string);

      // Authoritative direction change before the cast pose, same as
      // close combat — every viewer sees the caster turn toward the
      // target before the spell anim plays. Skipped when self-cast
      // (target == caster cell) since rotation is undefined there.
      //
      // Clamp to fight directions {1,3,5,7} — the client renderer
      // (`PlayerRenderer.setDirection`) clamps incoming 8-way values
      // anyway, so storing 8-way here would let the equality check
      // suppress legitimate re-emits (e.g. tracked=6=N matches a new
      // computed=6 even though the sprite renders 5=NW and a different
      // target now wants 5).
      if (
        resolution.targetCell !== resolution.caster.cell &&
        resolution.targetCell >= 0
      ) {
        const facing = clampFightDirection(
          getDirection(
            resolution.caster.cell,
            resolution.targetCell,
            fight.fightMap.width
          )
        );
        if (facing !== resolution.caster.direction) {
          resolution.caster.direction = facing;
          this.frames.broadcast(
            targets,
            create(DofusMessageSchema, {
              payload: {
                case: "gameAction",
                value: create(GameActionSchema, {
                  sequenceId: 5,
                  actionType: 5,
                  spriteId: String(resolution.caster.id),
                  actionData: {
                    case: "directionChange",
                    value: create(ActionDirectionChangeSchema, {
                      spriteId: String(resolution.caster.id),
                      direction: facing,
                    }),
                  },
                }),
              },
            })
          );
        }
      }

      // GA;300 — Spell cast animation. MUST be broadcast BEFORE
      // `apply()` runs effect handlers (which emit GA;100 damage,
      // GA;108 heal, summon, status). Otherwise the client receives
      // the damage GA while `spellSequencer` is still its initial
      // `Promise.resolve()` and the popup fires at cast-button-press
      // instead of at projectile arrival. Canonical Dofus 1.29 queues
      // GA;100 actions on the per-sprite Sequencer AFTER GA;300, so
      // this order matches the wire contract.
      this.frames.broadcast(
        targets,
        create(DofusMessageSchema, {
          payload: {
            case: "gameAction",
            value: create(GameActionSchema, {
              sequenceId: 300,
              actionType: GameActionType.ACTION_SPELL_LAUNCH,
              spriteId: String(resolution.caster.id),
              actionData: {
                case: "spellLaunch",
                value: create(ActionSpellLaunchSchema, {
                  spellId: resolution.spellId,
                  cellId: resolution.targetCell,
                  elementId: 0,
                  // param3 carries the visual gfx id — the SWF/dofasset
                  // filename the client must load. Mirrors Hetwan's
                  // GA;300 `visual` field. Multiple gameplay spells
                  // routinely share one gfx file (StarLoco sorts.sprite).
                  // SpellsService coalesces NULL → spellId server-side,
                  // so this is always populated.
                  param3: resolution.spell.visualGfxId,
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

      // Phase 2 — mutate state and emit damage / heal / summon / etc.
      // GAs. The frame-emitter calls flow out of effect handlers,
      // landing on the wire AFTER the GA;300 broadcast above.
      const result = this.castSpell.apply(resolution);

      // GA;102 — AP cost. After damage so the AP popup queues behind
      // the spell visual and damage popup on the client (canonical
      // Sequencer ordering: GA;300 → GA;100 → GA;102).
      this.frames.broadcast(
        targets,
        create(DofusMessageSchema, {
          payload: {
            case: "gameAction",
            value: create(GameActionSchema, {
              sequenceId: 102,
              actionType: 102,
              spriteId: String(resolution.caster.id),
              actionData: {
                case: "apChange",
                value: create(ActionAPChangeSchema, {
                  spriteId: String(resolution.caster.id),
                  delta: -resolution.spell.apCost,
                  used: resolution.spell.apCost,
                }),
              },
            }),
          },
        })
      );

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

    // Authoritative direction change — face the target before the
    // punch. The client computes a fallback direction in onSpellCast,
    // but pushing it from the server (a) keeps every viewer's render
    // in sync (otherwise the local-prediction guess can race with
    // the spell-launch handler), (b) carries the new facing into
    // future TURN_MIDDLE snapshots so the fighter doesn't snap back
    // to its placement direction after the punch reverts to idle.
    //
    // Clamp to fight directions {1,3,5,7} — the client renderer
    // clamps anyway, so storing 8-way here desyncs the equality check
    // and silently suppresses re-emits.
    const facing = clampFightDirection(
      getDirection(fighter.cell, cellId, fight.fightMap.width)
    );
    if (facing !== fighter.direction) {
      fighter.direction = facing;
      this.broadcastToFight(
        fight,
        create(DofusMessageSchema, {
          payload: {
            case: "gameAction",
            value: create(GameActionSchema, {
              sequenceId: 5,
              actionType: 5,
              spriteId: String(fighter.id),
              actionData: {
                case: "directionChange",
                value: create(ActionDirectionChangeSchema, {
                  spriteId: String(fighter.id),
                  direction: facing,
                }),
              },
            }),
          },
        })
      );
    }

    // GA;300 — close-combat cast pose. Mirrors canonical Dofus 1.29
    // which broadcasts a SpellLaunch with `animation = "anim0"` (the
    // melee punch frame in every player's atlas) so other clients see
    // the attacker swing before the damage popup. Without this the
    // attacker's sprite stays in idle and the strike feels lifeless.
    this.broadcastToFight(
      fight,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId: 300,
            actionType: GameActionType.ACTION_SPELL_LAUNCH,
            spriteId: String(fighter.id),
            actionData: {
              case: "spellLaunch",
              value: create(ActionSpellLaunchSchema, {
                spellId: 0,
                cellId,
                elementId: 0,
                // No spell-visual gfx for close combat — clients must
                // not try to fetch /spells/0.dofasset.
                param3: 0,
                customSprite: -1,
                // "anim0" = melee punch in the canonical client.
                animation: "anim0",
              }),
            },
          }),
        },
      })
    );

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
      // Free the corpse's cell so future LoS / range checks don't
      // reject casts that fly over it. Mirrors the cast-path cleanup
      // in `runApply`.
      if (target.cell >= 0) {
        fight.fightMap.free(target.cell, target.id);
      }

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

    const startCell = fighter.cell;
    fight.fightMap.free(fighter.cell, fighter.id);
    fighter.cell = endCell;
    fight.fightMap.occupy(endCell, fighter.id);
    fighter.spendMp(mpCost);

    // Update facing to match the last walk step. Without this, the
    // server's `fighter.direction` stays at whatever it was BEFORE the
    // walk (placement direction or previous cast facing), but the
    // client's rendered sprite rotated to the last-step direction as
    // it walked. The next spell cast's `if (facing !== direction)`
    // check then compares against the stale tracked value and silently
    // suppresses a legitimate `directionChange` emit, leaving the
    // sprite punching/casting in the wrong direction.
    const penultimate =
      cells.length >= 2 ? (cells[cells.length - 2] ?? startCell) : startCell;
    fighter.direction = clampFightDirection(
      getDirection(penultimate, endCell, fight.fightMap.width)
    );

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
