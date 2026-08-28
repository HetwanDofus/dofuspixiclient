import type { LiveNpc } from "@modules/npcs/map-npc.service";
import type { PatrolStep } from "@modules/npcs/npc-wander.path";
import { create } from "@bufbuild/protobuf";
import {
  ActionMovementSchema,
  GameActionSchema,
  GameActionsStartSchema,
  GameActionType,
} from "@dofus/proto/game_pb";
import { DofusMessageSchema } from "@dofus/proto/server_messages_pb";
import { MapCacheService } from "@modules/maps/maps.cache.service";
import { MapNpcService } from "@modules/npcs/map-npc.service";
import { NpcDialogSessionService } from "@modules/npcs/npc-dialog.session";
import {
  parsePatrol,
  reverseDirection,
  walkStep,
} from "@modules/npcs/npc-wander.path";
import { PlayerPresenceService } from "@modules/player-presence/player-presence.service";
import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { GatewayFrameService } from "@shared/gateway-adapter/gateway-frame.service";

/** How often the tick fires. Canonical NPCs stroll; they do not commute. */
const TICK_MS = 6_000;

/**
 * Sequence ids for NPC walks.
 *
 * Deliberately its own counter, and deliberately negative:
 * `PendingMovesService` hands out positive ids for player moves and
 * `MoveAckHandler` matches an inbound `GameActionAck` against them by id
 * alone. An NPC step that reused that range could be acknowledged as a
 * player's move — the client does not ack other people's sprites, but a
 * misbehaving one could, and the two spaces cost nothing to separate.
 */
let nextSequenceId = -1;

interface PatrolState {
  /** Where the route started, so the walk back has something to aim at. */
  steps: PatrolStep[];
  index: number;
  /** False while replaying the route in reverse. */
  forward: boolean;
}

/**
 * Walks the NPCs that the dump flags movable.
 *
 * `npcs.isMovable` is set on 73 placements but only 14 of them belong to a
 * template with a `path`, so this moves 14 NPCs in the whole world — it is
 * flavour, not a subsystem. The tick reflects that: it only looks at maps
 * that `MapNpcService` has already resolved *and* that have a player on them,
 * so an empty world does no work at all.
 *
 * The wire form is the ordinary one. `GameAction` / `ACTION_MOVEMENT` with
 * `path_cells` is what the client animates for any sprite that is not its own
 * (`map.handler.ts` `handleActorPath`), and it does not acknowledge those — so
 * no path encoding and no pending-move bookkeeping is needed here.
 */
@Injectable()
export class NpcWanderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NpcWanderService.name);
  private readonly patrols = new Map<number, PatrolState>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly npcs: MapNpcService,
    private readonly mapCache: MapCacheService,
    private readonly presence: PlayerPresenceService,
    private readonly dialogs: NpcDialogSessionService,
    private readonly frames: GatewayFrameService
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.tick().catch((err: unknown) => {
        this.logger.warn(`wander tick failed: ${String(err)}`);
      });
    }, TICK_MS);
    // Node keeps the process alive for a pending interval; a background
    // stroll must never be the reason a core refuses to exit.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for the spec; the interval is the only production caller. */
  async tick(): Promise<void> {
    for (const mapId of this.npcs.loadedMapIds()) {
      const sessions = this.presence.sessionsOnMap(mapId);
      if (sessions.length === 0) {
        continue;
      }

      const map = await this.mapCache.load(mapId);
      if (!map) {
        continue;
      }

      const walkable = new Set<number>();
      for (const cell of map.cells) {
        if (cell.active && cell.walkable) {
          walkable.add(cell.id);
        }
      }

      for (const npc of await this.npcs.onMap(mapId)) {
        this.step(npc, map.width, walkable, sessions);
      }
    }
  }

  private step(
    npc: LiveNpc,
    mapWidth: number,
    walkable: ReadonlySet<number>,
    sessions: string[]
  ): void {
    if (!npc.isMovable || npc.path.trim() === "") {
      return;
    }

    // Canonical: an NPC being talked to holds still. Without this it strolls
    // off while the player reads, and the dialog window ends up pointing at
    // an empty cell.
    if (this.dialogs.isBusy(npc.id)) {
      return;
    }

    const state = this.patrolFor(npc);
    if (state.steps.length === 0) {
      return;
    }

    const step = state.steps[state.index];
    if (!step) {
      return;
    }

    const direction = state.forward
      ? step.direction
      : reverseDirection(step.direction);

    const cells = walkStep(
      npc.cellId,
      { direction, cells: step.cells },
      mapWidth,
      // An NPC never shares a cell with another NPC on the same map; players
      // are not checked, because 1.29 lets sprites overlap outside combat and
      // blocking on one would stall the patrol for as long as someone stands
      // there.
      (cell) => walkable.has(cell)
    );

    this.advance(state);

    if (cells.length === 0) {
      return;
    }

    const from = npc.cellId;
    npc.cellId = cells[cells.length - 1] ?? from;
    npc.direction = direction;

    const sequenceId = nextSequenceId--;

    this.frames.broadcast(
      sessions,
      create(DofusMessageSchema, {
        payload: {
          case: "gameActionsStart",
          value: create(GameActionsStartSchema, { spriteId: String(npc.id) }),
        },
      })
    );

    this.frames.broadcast(
      sessions,
      create(DofusMessageSchema, {
        payload: {
          case: "gameAction",
          value: create(GameActionSchema, {
            sequenceId,
            actionType: GameActionType.ACTION_MOVEMENT,
            spriteId: String(npc.id),
            rawParams: "",
            actionData: {
              case: "movement",
              value: create(ActionMovementSchema, {
                pathCells: [from, ...cells],
              }),
            },
          }),
        },
      })
    );
  }

  /**
   * The route runs forward to its end then back to the start, rather than
   * looping: no route in the dump closes on itself (`"G2;B1"` would strand the
   * NPC one cell down-left of where it began, drifting a little further every
   * cycle), so a there-and-back is the only reading that keeps it home.
   */
  private advance(state: PatrolState): void {
    if (state.forward) {
      if (state.index + 1 < state.steps.length) {
        state.index++;
      } else {
        state.forward = false;
      }
      return;
    }

    if (state.index > 0) {
      state.index--;
    } else {
      state.forward = true;
    }
  }

  private patrolFor(npc: LiveNpc): PatrolState {
    const existing = this.patrols.get(npc.id);
    if (existing) {
      return existing;
    }

    const state: PatrolState = {
      steps: parsePatrol(npc.path),
      index: 0,
      forward: true,
    };
    this.patrols.set(npc.id, state);
    return state;
  }
}
