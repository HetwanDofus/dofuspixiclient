/**
 * Stress test for the player + accessory rendering pipeline.
 *
 * Adds N players at random visible cells with random looks (random
 * class, random colors, random accessories). Wired into a window
 * global by `BattlefieldScene` so it can be triggered from DevTools:
 *
 *   spawnTestPlayers(20)   // spawn 20 random players
 *   despawnTestPlayers()   // remove them all
 *
 * Validates that:
 *   - PlayerRenderer scales to N concurrent characters.
 *   - Accessory composition (`renderSwfStripRangeAccessorized`) holds
 *     up under random type/gfxId combinations.
 *   - Per-frame Vello dispatch overhead remains in the playable range
 *     when the map has lots of moving sprites.
 *
 * SAFETY: previous runs at unbounded N caused the host driver to hang
 * (the watchdog auto-halt now catches this, but prevention is cheaper
 * than recovery). HARD_CAP below is the absolute ceiling — every spawn
 * call clamps N to it. The movement loop staggers per-player so they
 * don't all dispatch on the same tick.
 */
import type { CellData } from "@/game/datacenter/cell";
import type { PlayerRenderer } from "@/game/scene/player/renderer";
import { getRenderWatchdog } from "@/game/render/render-watchdog";
import { createLogger } from "@/utils/logger";

const log = createLogger("StressTest");

/**
 * gfxIds known to render via the new SWF pipeline. The full vanilla
 * Dofus 1.29 set is `(class * 10) + gender` for class 1..12, gender 0/1
 * — i.e. 10/11, 20/21, …, 120/121 — but a few classes have asset gaps
 * in the public archive; this curated list is the safe subset that
 * loads + renders via `sprite-N.swf` paths.
 */
const KNOWN_GFX_IDS = [
  10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 60, 61, 70, 71, 80, 81, 90, 91, 100,
  101, 110, 111, 120, 121,
];

/**
 * Curated `(type, gfxId)` accessory pairs known to exist in the
 * public archive. Mixed across the 5 look slots — the builder picks
 * randomly per slot. Unknown pairs silently skip during accessory
 * resolution (`resolveAccessoryBundle` → null), so the worst case is
 * a player rendered without that accessory; never a crash.
 */
const RANDOM_HATS = [1, 2, 5, 7, 10, 15, 20];
const RANDOM_WEAPONS = [1, 2, 3, 5, 8, 12];
const RANDOM_CAPES = [1, 2, 3, 4];
const RANDOM_SHIELDS = [1, 2, 3];

/**
 * Hard ceiling on concurrent test players. Picked empirically — at
 * ~50 fighters with random looks the GPU pipeline still holds 60fps
 * on a typical M-series laptop; above ~150 the accessorized atlas
 * builds saturate the WebGPU command queue and frame times spike to
 * 100ms+. Above 200 the watchdog auto-halts before the host driver
 * gets pushed over the edge. The cap is checked at every spawn entry
 * point — both `spawnTestPlayers(N)` and the window glue clamp to it.
 */
const HARD_CAP = 200;
/** Soft warning threshold — keeps the dev console honest about cost. */
const SOFT_WARN = 75;
/**
 * Min ms between consecutive spawns (independent of `delayMs`). At 5ms
 * spacing 100 players spawn in 500ms but every spawn dispatches a
 * 24-frame strip render — the WebGPU queue can't drain that fast.
 * 50ms keeps the queue near-empty and lets the user see progress in
 * the watchdog HUD.
 */
const MIN_SPAWN_INTERVAL_MS = 50;
const TEST_PLAYER_ID_BASE = 9_000_000;
const DEFAULT_MOVE_PERIOD_MS = 2000;
/**
 * Max movement-loop period jitter per player. Each player picks an
 * independent offset within the period so the renderer.movePlayer()
 * calls are spread across the period rather than all firing on the
 * same tick — that pattern is what creates the "every 2s the frame
 * time spikes to 80ms" sawtooth observed in earlier stress runs.
 */

interface SpawnOptions {
  /** Per-spawn delay in ms — keeps the GPU queue from saturating during big batches. */
  delayMs?: number;
  /** Period of random-direction-change movement loop. Default 2000ms. */
  movePeriodMs?: number;
}

interface ActivePlayer {
  id: number;
  /** Per-player movement timer. Distinct timers stagger move dispatches across the period. */
  moveTimer: ReturnType<typeof setTimeout> | null;
}

let activePlayers = new Map<number, ActivePlayer>();
let watchdogUnsubscribe: (() => void) | null = null;

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomColor(): number {
  return Math.floor(Math.random() * 0xffffff);
}

function buildRandomLook(): string {
  const gfx = pick(KNOWN_GFX_IDS);
  const c1 = randomColor();
  const c2 = randomColor();
  const c3 = randomColor();
  // Each slot is "type_gfxId" or empty if no accessory for that slot.
  const slots: string[] = ["", "", "", "", ""];
  // Weapon (look[0], type 6)
  if (Math.random() < 0.85) {
    slots[0] = `6_${pick(RANDOM_WEAPONS)}`;
  }
  // Hat (look[1], type 16)
  if (Math.random() < 0.85) {
    slots[1] = `16_${pick(RANDOM_HATS)}`;
  }
  // Cape (look[2], type 17 — cloak in Dofus 1.29 item types).
  if (Math.random() < 0.4) {
    slots[2] = `17_${pick(RANDOM_CAPES)}`;
  }
  // Pet (look[3], type 18) — has no body-part mount in the player
  // SWF; needs separate sibling-sprite rendering (not yet wired).
  // Skipped from the test look so we don't pollute logs with
  // resolver misses.
  // Shield (look[4], type 82).
  if (Math.random() < 0.4) {
    slots[4] = `82_${pick(RANDOM_SHIELDS)}`;
  }
  return `${gfx}|${c1}|${c2}|${c3}|${slots.join(",")}`;
}

function pickRandomCell(cells: CellData[]): CellData | null {
  const active = cells.filter(
    (c) => c.active && (c.movement ?? 0) > 1 && c.lineOfSight !== false
  );
  if (active.length === 0) {
    return null;
  }
  return active[Math.floor(Math.random() * active.length)] ?? null;
}

/**
 * Ensure the watchdog kill-switch is wired exactly once. Idempotent —
 * subsequent spawn cycles reuse the existing subscription.
 */
function ensureWatchdogWiring(renderer: PlayerRenderer): void {
  if (watchdogUnsubscribe) {
    return;
  }
  watchdogUnsubscribe = getRenderWatchdog().onEmergencyHalt(() => {
    if (activePlayers.size === 0) {
      return;
    }
    log.warn(
      `Emergency halt — despawning ${activePlayers.size} test players to relieve GPU pressure.`
    );
    despawnTestPlayers(renderer);
  });
}

/**
 * Schedule one move tick for `id`. Each player is its own setTimeout
 * chain — no shared interval — so collective dispatches scatter across
 * the period instead of spiking.
 */
function scheduleMove(
  id: number,
  renderer: PlayerRenderer,
  cells: CellData[],
  periodMs: number
): void {
  const entry = activePlayers.get(id);
  if (!entry) {
    return;
  }
  // Per-tick jitter ±20% of period so even players that started in
  // the same batch drift out of phase over time.
  const jitter = periodMs * (0.8 + Math.random() * 0.4);
  entry.moveTimer = setTimeout(() => {
    const cur = activePlayers.get(id);
    if (!cur) {
      return; // despawned mid-wait — bail.
    }
    if (getRenderWatchdog().isHalted()) {
      // Halt is on; don't enqueue more GPU work. The watchdog handler
      // will eventually call despawnTestPlayers and clean us up.
      return;
    }
    const target = pickRandomCell(cells);
    if (target) {
      void renderer.movePlayer(id, [target.id]).catch(() => {
        /* movement rejected — try again next tick */
      });
    }
    scheduleMove(id, renderer, cells, periodMs);
  }, jitter);
}

/** Spawn `n` random players. Returns once all addPlayer promises resolve. */
export async function spawnTestPlayers(
  n: number,
  renderer: PlayerRenderer,
  cells: CellData[],
  opts: SpawnOptions = {}
): Promise<number[]> {
  ensureWatchdogWiring(renderer);
  if (getRenderWatchdog().isHalted()) {
    log.warn(
      "spawnTestPlayers refused: watchdog is halted. Call window.__renderResume() to clear, then retry."
    );
    return [];
  }

  const requested = n;
  const headroom = Math.max(0, HARD_CAP - activePlayers.size);
  if (n > headroom) {
    log.warn(
      `spawnTestPlayers: clamping N=${n} → ${headroom} (HARD_CAP=${HARD_CAP}, already active=${activePlayers.size}).`
    );
    n = headroom;
  }
  if (n + activePlayers.size > SOFT_WARN) {
    log.warn(
      `spawnTestPlayers: heading to ${n + activePlayers.size} concurrent fighters; expect frame-time spikes during accessorized strip builds.`
    );
  }
  if (n <= 0) {
    return [];
  }

  const periodMs = Math.max(500, opts.movePeriodMs ?? DEFAULT_MOVE_PERIOD_MS);
  const spawnDelay = Math.max(opts.delayMs ?? 0, MIN_SPAWN_INTERVAL_MS);

  const ids: number[] = [];
  // SEQUENTIAL SPAWN — await each addPlayer to resolve BEFORE the next
  // starts. The previous parallel `Promise.all(promises)` pattern let
  // 200 addPlayer chains live simultaneously: each holds an in-flight
  // wgpu strip-bake, a Pixi sprite construction, and a picking-system
  // registration. The wgpu command queue accumulated 200+ pending
  // texture allocations + render_to_texture submissions; when the
  // GPU finally drained them in one batch the JS rAF callback stalled
  // 2+ seconds (the "probable GPU hang" auto-halt symptom).
  //
  // Sequential spawn caps inflight concurrent GPU work to 1 player
  // chain at a time. Total spawn time is the same (50ms × N = 10s
  // for N=200) but the GPU command queue never exceeds what one
  // addPlayer queues, which the strip-bake throttle (2/frame) and
  // Pixi compositor handle without stalling.
  for (let i = 0; i < n; i++) {
    if (getRenderWatchdog().isHalted()) {
      log.warn(
        `spawnTestPlayers: watchdog halted mid-batch at ${i}/${requested}; aborting.`
      );
      break;
    }
    const cell = pickRandomCell(cells);
    if (!cell) {
      log.warn(
        `spawnTestPlayers: no walkable cell available, stopping at ${i}/${n}`
      );
      break;
    }
    const id = TEST_PLAYER_ID_BASE + activePlayers.size + i;
    ids.push(id);
    activePlayers.set(id, { id, moveTimer: null });
    await renderer.addPlayer({
      id,
      name: `Bot${i}`,
      team: i % 2,
      cellId: cell.id,
      direction: Math.floor(Math.random() * 8),
      look: buildRandomLook(),
      hp: 100,
      maxHp: 100,
      isPlayer: false,
      decorative: true,
    });
    if (spawnDelay > 0) {
      await new Promise((r) => setTimeout(r, spawnDelay));
    }
  }
  log.info(`spawned ${ids.length} test players (requested=${requested})`);

  // Each player gets its own staggered movement schedule — see comment
  // on scheduleMove for why we don't use a single shared interval.
  for (const id of ids) {
    scheduleMove(id, renderer, cells, periodMs);
  }
  return ids;
}

/** Remove every test-spawned player. */
export function despawnTestPlayers(renderer: PlayerRenderer): number {
  const n = activePlayers.size;
  for (const entry of activePlayers.values()) {
    if (entry.moveTimer) {
      clearTimeout(entry.moveTimer);
      entry.moveTimer = null;
    }
    try {
      renderer.removePlayer(entry.id);
    } catch (e) {
      // Swallow per-player removal errors so one bad id doesn't
      // strand the rest. This path runs from the emergency-halt
      // handler too — it MUST always drain the map.
      log.warn(`despawnTestPlayers: removePlayer(${entry.id}) threw:`, e);
    }
  }
  activePlayers = new Map();
  log.info(`despawned ${n} test players`);
  return n;
}

/** Diagnostic: how many test players are currently spawned. */
export function getTestPlayerCount(): number {
  return activePlayers.size;
}
