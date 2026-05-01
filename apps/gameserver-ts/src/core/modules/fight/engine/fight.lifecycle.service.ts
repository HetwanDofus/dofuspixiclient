import type { Fight } from "@modules/fight/core/fight.entity";
import { create } from "@bufbuild/protobuf";
import {
  GameStartToPlaySchema,
  GameTurnFinishSchema,
  GameTurnListSchema,
  GameTurnMiddleSchema,
  GameTurnStartSchema,
  TurnMiddleEntrySchema,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { CastSpellUseCase } from "@modules/fight/cast/fight.cast";
import { ActiveState } from "@modules/fight/core/fight.active-state";
import { EffectRegistry } from "@modules/fight/effects/fight.effect-registry";
import { MonsterAI } from "@modules/fight/engine/fight.ai";
import { FightEndService } from "@modules/fight/engine/fight.end.service";
import { FightFrameEmitter } from "@modules/fight/engine/fight.frame-emitter";
import { Runner } from "@modules/fight/engine/fight.runner";
import { FightRegistryService } from "@modules/fight/registry/fight.registry";
import { SpellsService } from "@modules/spells/spells.service";
import { Injectable, Logger } from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";
import { match } from "ts-pattern";

@Injectable()
export class FightLifecycleService {
  private readonly logger = new Logger(FightLifecycleService.name);

  constructor(
    private readonly fightRegistry: FightRegistryService,
    private readonly fightEnd: FightEndService,
    private readonly spells: SpellsService,
    private readonly effectRegistry: EffectRegistry,
    private readonly frameEmitter: FightFrameEmitter,
    private readonly frames: GatewayFrameService
  ) {}

  startFight(fight: Fight): void {
    const targets = this.fightSessions(fight);

    // GS — Game Start
    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameStartToPlay",
          value: create(GameStartToPlaySchema, {}),
        },
      })
    );

    // Transition to Active state
    const active = new ActiveState();
    fight.transition(active);

    // GTL — Turn list
    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameTurnList",
          value: create(GameTurnListSchema, {
            spriteIds: active.turnList.fighters().map((f) => String(f.id)),
          }),
        },
      })
    );

    // GTM — Fighter stats snapshot
    this.frames.broadcast(
      targets,
      create(DofusMessageSchema, {
        payload: {
          case: "gameTurnMiddle",
          value: create(GameTurnMiddleSchema, {
            entries: fight.fighters().map((f) =>
              create(TurnMiddleEntrySchema, {
                spriteId: String(f.id),
                isDead: f.dead,
                lp: f.lp,
                ap: f.ap,
                mp: f.mp,
                cellNum: f.cell,
                lpMax: f.lpMax,
              })
            ),
          }),
        },
      })
    );

    // Start the turn loop runner with monster AI
    const frameSink = this.createFrameSink(fight);
    const runner = new Runner(fight, active, frameSink, 30_000);

    // Wire spell casting into the AI
    const castUseCase = new CastSpellUseCase(
      { bySession: (sid) => this.fightRegistry.getBySession(sid) },
      this.spells,
      this.effectRegistry,
      this.frameEmitter
    );

    const ai = new MonsterAI(
      (fighterId) => runner.requestEnd(fighterId),
      async (fightObj, caster, spellId, targetCell, level) => {
        await castUseCase.castFor(fightObj, caster, spellId, targetCell, level);
      },
      (fightObj, fighter, pathCells) => {
        this.frameEmitter.emitMovement(fightObj, fighter.id, pathCells);
      }
    );
    runner.setObserver(ai);
    this.fightRegistry.addRunner(fight.id, runner);
    runner.start();

    this.logger.log(`Fight ${fight.id} entered active state`);
  }

  private createFrameSink(fight: Fight) {
    return {
      broadcast: (_fight: Fight, messageId: string, payload: unknown) => {
        const targets = this.fightSessions(fight);

        match(messageId)
          .with("GTL", () => {
            const p = payload as { spriteIds: string[] };
            this.frames.broadcast(
              targets,
              create(DofusMessageSchema, {
                payload: {
                  case: "gameTurnList",
                  value: create(GameTurnListSchema, { spriteIds: p.spriteIds }),
                },
              })
            );
          })
          .with("GTS", () => {
            const p = payload as {
              spriteId: string;
              timeMs: number;
              tableTurnNum: number;
            };
            this.frames.broadcast(
              targets,
              create(DofusMessageSchema, {
                payload: {
                  case: "gameTurnStart",
                  value: create(GameTurnStartSchema, {
                    spriteId: p.spriteId,
                    timeMs: p.timeMs,
                    tableTurnNum: p.tableTurnNum,
                  }),
                },
              })
            );
          })
          .with("GTF", () => {
            const p = payload as { spriteId: string };
            this.frames.broadcast(
              targets,
              create(DofusMessageSchema, {
                payload: {
                  case: "gameTurnFinish",
                  value: create(GameTurnFinishSchema, { spriteId: p.spriteId }),
                },
              })
            );
          })
          .with("GTM", () => {
            const p = payload as {
              entries: Array<{
                spriteId: string;
                cell: number;
                lp: number;
                lpMax: number;
                ap: number;
                mp: number;
                isDead: boolean;
              }>;
            };
            this.frames.broadcast(
              targets,
              create(DofusMessageSchema, {
                payload: {
                  case: "gameTurnMiddle",
                  value: create(GameTurnMiddleSchema, {
                    entries: p.entries.map((e) =>
                      create(TurnMiddleEntrySchema, {
                        spriteId: e.spriteId,
                        cellNum: e.cell,
                        lp: e.lp,
                        // Forward lpMax + isDead so the client's
                        // FIGHTER_UPDATE patch carries the full
                        // snapshot. Without lpMax the proto default
                        // (0) wipes maxHp on every turn change and
                        // breaks the HP bar ratio downstream.
                        lpMax: e.lpMax,
                        ap: e.ap,
                        mp: e.mp,
                        isDead: e.isDead,
                      })
                    ),
                  }),
                },
              })
            );
          })
          .with("GE", () => {
            this.fightEnd.endFight(fight).catch((err) => {
              this.logger.error(`Failed to end fight ${fight.id}:`, err);
            });
          })
          .otherwise(() => {});
      },
      sendTo: (sessionId: string, _messageId: string, _payload: unknown) => {
        this.logger.debug(`sendTo ${sessionId} ${_messageId}`);
      },
    };
  }

  private fightSessions(fight: Fight): string[] {
    return fight.allSessions();
  }
}
