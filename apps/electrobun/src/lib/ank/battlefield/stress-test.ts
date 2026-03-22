import type { CellData } from "./datacenter/cell";
import type { FighterRenderer } from "./fighter-renderer";
import { DofusPathfinding } from "./dofus-pathfinding";

const GFX_POOL = [
  10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90, 91, 100,
  101, 110, 111,
];
const ACTOR_COUNT = 500;
const MOVE_INTERVAL_MIN = 1500;
const MOVE_INTERVAL_MAX = 4000;

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

    console.log(`[StressTest] Spawning ${ACTOR_COUNT} actors...`);
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

      this.renderer.addFighter({
        id,
        name: `Bot-${i}`,
        team: i % 2,
        cellId,
        direction,
        look: `${gfxId}`,
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

    console.log(`[StressTest] All ${ACTOR_COUNT} actors spawned.`);
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
    console.log("[StressTest] Stopped and cleaned up.");
  }
}
