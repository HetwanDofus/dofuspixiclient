/**
 * THE single tile behavior→executor mapping (wc3 render_tiles model,
 * dofuswebclient3/rust/client/src/game/world/map/systems/render_tiles/
 * resolve.rs:56-79).
 *
 * A placement's behavior is decided at ONE point (placements.ts
 * `pushPlacementByKey`):
 *
 *  1. canonical pre-engine overrides — the engine external playhead
 *     forces that Flash applies AFTER attach: ground slope
 *     `tile.gotoAndStop(cell.groundSlope)`
 *     (assets/sources/client-code/ank/battlefield/MapHandler.as:224-227)
 *     and the tactic-decor `gotoAndStop(counter % 3 + 1)` round-robin —
 *     carried as `{ source: "forced" }`;
 *  2. otherwise the wasm classifier's result — the byte-equal port of
 *     wc3's `tile_behavior::resolve_full` executing the export's
 *     frame-1 AS2 with the per-cell seed — carried VERBATIM as
 *     `{ source: "engine" }`.
 *
 * A wasm refusal (bundle missing / renderer halted) is an ERROR path
 * (`reason: "engine-refused"`, rendered static frame 0) — never a
 * second classifier. There is NO token-scan / manifest-kind routing
 * anywhere above the engine.
 *
 * The renderer then picks its EXECUTOR mechanically from the plan via
 * `tileExecutorFor` — a pure function, so route/classification
 * disagreements are impossible by construction (see
 * `MapHandler.tileRoutingAudit`, now a tautology check).
 */
import { match } from "ts-pattern";

import type { SwfTileBehavior } from "@/game/render/vello-loader";

/** Routing plan carried on every tile placement. */
export type TileBehaviorPlan =
  | {
      source: "forced";
      /**
       * - `slope`: ground layer with `groundSlope != 1` — canonical
       *   external `gotoAndStop(slope)` (MapHandler.as:226; wc3
       *   render_tiles/resolve.rs:69-77).
       * - `override`: explicit tactic-decor frame.
       * - `engine-refused`: classifier error path (static frame 0).
       */
      reason: "slope" | "override" | "engine-refused";
      frame: number;
    }
  | { source: "engine"; behavior: SwfTileBehavior };

/**
 * How the renderer executes a plan. Pure raster packaging — carries no
 * classification decisions of its own:
 *  - `fixed`: single-cell bake of an externally forced frame (atlas
 *    kind 0).
 *  - `seeded`: canonical static variant — executed frame + frozen-child
 *    pins, shared by `sig` (atlas kind 1).
 *  - `strip`: simple loop — every playable frame as consecutive cells,
 *    per-cell phase (atlas kind 2).
 *  - `instance`: per-instance AVM1 playheads (`tileInstanceCreate` +
 *    `tickTileInstances`).
 */
export type TileExecutor =
  | { mode: "fixed"; frame: number }
  | { mode: "seeded"; frame: number; sig: number }
  | { mode: "strip"; cycle: number; phaseSeed: number }
  | { mode: "instance" };

/**
 * Map a behavior plan to its executor — mechanically. wc3 equivalence:
 * Static{frame} → frozen bake; Animated & simple loop → linear frame
 * counter (wc2's strip cells ARE that counter); anything else →
 * per-instance scripted playheads (wc3 ticks a TileAnimator; wc2 ticks
 * the wasm tile instance). The `loop`/`scripted` split is the engine's
 * own `is_simple_loop` predicate, evaluated wasm-side in
 * `swfTileBehavior` — not re-derived here.
 */
export function tileExecutorFor(plan: TileBehaviorPlan): TileExecutor {
  if (plan.source === "forced") {
    return { mode: "fixed", frame: plan.frame };
  }
  return match(plan.behavior)
    .with({ kind: "static" }, (b) => ({
      mode: "seeded" as const,
      frame: b.frame ?? 0,
      sig: b.sig ?? 0,
    }))
    .with({ kind: "loop" }, (b) => ({
      mode: "strip" as const,
      cycle: Math.max(1, b.cycle ?? 1),
      phaseSeed: b.phaseSeed ?? 0,
    }))
    .with({ kind: "scripted" }, () => ({ mode: "instance" as const }))
    .exhaustive();
}
