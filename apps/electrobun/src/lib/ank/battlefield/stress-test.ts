import { createLogger } from "@/utils/logger";

import type { CellData } from "./datacenter/cell";
import type { FighterRenderer } from "./fighter-renderer";
import { DofusPathfinding } from "./dofus-pathfinding";

const log = createLogger("StressTest");

const GFX_POOL = [10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90, 91, 100, 101, 110, 111, 120,121];
const ACTOR_COUNT = 500;
const MOVE_INTERVAL_MIN = 1500;
const MOVE_INTERVAL_MAX = 4000;

// Accessory pools for random look generation (type_gfxId format)
const HAT_POOL = [
  "16_10",
  "16_3",
  "16_4",
  "16_11",
  "16_12",
  "16_102",
  "16_103",
  "16_104",
  "16_105",
  "16_106",
  "16_107",
  "16_108",
  "16_109",
  "16_110",
  "16_111",
  "16_112",
  "16_113",
  "16_114",
  "16_115",
  "16_116",
  "16_117",
  "16_118",
  "16_119",
  "16_120",
  "16_121",
  "16_122",
  "16_123",
  "16_124",
  "16_125",
  "16_126",
  "16_127",
];
const CAPE_POOL = [
  "17_5",
  "17_10",
  "17_17",
  "17_19",
  "17_21",
  "17_88",
  "17_1",
  "17_2",
  "17_3",
  "17_4",
  "17_6",
  "17_7",
  "17_8",
  "17_9",
  "17_11",
  "17_12",
  "17_13",
  "17_14",
  "17_15",
  "17_16",
];
const SHIELD_POOL = [
  "82_10",
  "82_30",
  "82_37",
  "82_39",
  "82_1",
  "82_2",
  "82_3",
  "82_4",
  "82_5",
  "82_6",
  "82_7",
  "82_8",
  "82_9",
  "82_11",
  "82_12",
  "82_13",
  "82_14",
  "82_15",
];

function randomColor(): number {
  return Math.floor(Math.random() * 0xffffff);
}

function buildRandomLook(gfxId: number): string {
  const c1 = randomColor();
  const c2 = randomColor();
  const c3 = randomColor();
  // 70% chance to have each accessory
  const weapon = "";
  const hat = Math.random() < 0.7 ? randomItem(HAT_POOL) : "";
  const cape = Math.random() < 0.7 ? randomItem(CAPE_POOL) : "";
  const pet = "";
  const shield = Math.random() < 0.7 ? randomItem(SHIELD_POOL) : "";
  return `${gfxId}|${c1}|${c2}|${c3}|${weapon},${hat},${cape},${pet},${shield}`;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

interface StressActor {
  id: number;
  cellId: number;
  moving: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

export class StressTest {
  private renderer: FighterRenderer;
  private pathfinding: DofusPathfinding;
  private walkableCells: number[];
  private actors: StressActor[] = [];
  private running = false;

  constructor(
    renderer: FighterRenderer,
    mapWidth: number,
    mapHeight: number,
    cells: CellData[]
  ) {
    this.renderer = renderer;
    const walkableIds = cells.filter((c) => c.walkable).map((c) => c.id);
    this.walkableCells = walkableIds;
    this.pathfinding = new DofusPathfinding(mapWidth, mapHeight, walkableIds);
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    log.info(`Spawning ${ACTOR_COUNT} actors...`);
    this.spawnBatched();
  }

  private async spawnBatched(): Promise<void> {
    const BATCH_SIZE = 50;

    for (let i = 0; i < ACTOR_COUNT; i++) {
      if (!this.running) return;

      const id = 100_000 + i;
      const cellId = randomItem(this.walkableCells);
      const gfxId = randomItem(GFX_POOL);
      const direction = randomInt(0, 7);
      const look = buildRandomLook(gfxId);

      this.renderer.addFighter({
        id,
        name: `Bot-${i}`,
        team: i % 2,
        cellId,
        direction,
        look,
        hp: 100,
        maxHp: 100,
        isPlayer: false,
      });

      const actor: StressActor = { id, cellId, moving: false, timer: null };
      this.actors.push(actor);

      // Stagger initial moves so they don't all fire at once
      const delay = Math.random() * 3000;
      actor.timer = setTimeout(() => this.scheduleMove(actor), delay);

      // Yield to the renderer every BATCH_SIZE fighters
      if ((i + 1) % BATCH_SIZE === 0) {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
      }
    }

    log.info(`All ${ACTOR_COUNT} actors spawned.`);
  }

  private scheduleMove(actor: StressActor): void {
    if (!this.running) return;

    actor.timer = setTimeout(
      () => {
        if (!this.running || actor.moving) return;
        this.moveRandomly(actor);
      },
      randomInt(MOVE_INTERVAL_MIN, MOVE_INTERVAL_MAX)
    );
  }

  private moveRandomly(actor: StressActor): void {
    // Pick a random walkable target within reasonable range
    const targetCell = randomItem(this.walkableCells);
    const path = this.pathfinding.findPath(actor.cellId, targetCell);

    if (!path || path.length < 2) {
      this.scheduleMove(actor);
      return;
    }

    // Truncate long paths to keep movements short (3-8 cells)
    const maxSteps = randomInt(3, 8);
    const truncated = path.slice(0, maxSteps + 1);

    actor.moving = true;
    this.renderer.moveFighter(actor.id, truncated).then(() => {
      actor.cellId = truncated[truncated.length - 1];
      actor.moving = false;
      this.scheduleMove(actor);
    });
  }

  stop(): void {
    this.running = false;
    for (const actor of this.actors) {
      if (actor.timer) clearTimeout(actor.timer);
      this.renderer.removeFighter(actor.id);
    }
    this.actors = [];
    log.info("Stopped and cleaned up.");
  }
}
