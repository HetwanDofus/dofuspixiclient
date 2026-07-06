/**
 * PlayerStripRenderer — strip-rendered character sprites mounted as
 * children of each player's Pixi container.
 *
 * Mirrors the validated stress-test pipeline (apps/electrobun/src/window/
 * mainview/stress-worker.ts:780-920): on anim swap, render the whole
 * animation in ONE Vello dispatch via `renderSwfStripRangeAccessorized`
 * → slice the composite into pre-allocated per-frame `Texture[]`
 * wrappers sharing one `ExternalSource` → per-tick frame advance is
 * a free Pixi `sprite.texture = currentFrames[i]` pointer swap.
 *
 * **Slot model** — each player can have up to four slots so mounted
 * characters render correctly without any worldLayer involvement:
 *
 *   mount-back   z=-2  player body's `_Back` half (replaces main body)
 *   mount-rider  z=-1  chevauchor sprite (the rider)
 *   main         z=0   regular body (hidden when mounted)
 *   mount-front  z=+1  player body's `_Front` half (mount head/neck)
 *
 * Pixi `sortableChildren` on the player container honors zIndex so
 * the painter's order matches canonical Dofus 1.29's
 * `MOUNT_DEPTH_BACK/RIDER/FRONT` sub-offsets.
 *
 * Per `feedback_pixi_wgpu_texture_lifetime`, the patched wgpu fork's
 * `Drop for WebTexture` is a no-op — every retired strip MUST pair
 * `oldSource.destroy()` with `freeRenderTexture(oldTextureId)` after
 * 2 ticks (so any in-flight Pixi sample of the old texture lands
 * before the wgpu storage is reclaimed).
 */
import {
  ImageSource,
  Rectangle,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import type { CharacterAnimation } from "@/game/assets/character-sprite";
import type { ActivePlayer } from "@/game/scene/player/types";
import {
  type AccessoryRenderEntry,
  getPixiRenderer,
  renderSwfStripRangeAccessorized,
  setSwfPlayerColors,
  uploadAndCloseBitmap,
  type VelloSwfStripResult,
} from "@/game/render/vello-loader";
import {
  getStripBakeQueue,
  type StripBakeCallback,
} from "@/game/render/strip-bake-queue";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerStripRenderer");

const TICK_INTERVAL_MS = 1000 / 60;
const RETIRE_DELAY_MS = 2 * TICK_INTERVAL_MS;

// Path B cut-over: every existing `import { PlayerStripRenderer }` from
// this module now lands on the V2 implementation (band-mesh + per-bot
// shader uniforms). The legacy single-strip path stays exported as
// `PlayerStripRendererLegacy` for rollback / pixel-parity tests.
export { PlayerStripRendererV2 as PlayerStripRenderer } from "./player-strip-renderer-v2";

export type DirSuffix = "R" | "L" | "F" | "B" | "S";

/**
 * Painter's-order slot identifier for per-player sprites.
 * Mirrors canonical mount sub-depths in `mount-layers.ts`.
 */
export type PlayerStripSlot =
  | "main"
  | "mount-back"
  | "mount-rider"
  | "mount-front";

const SLOT_Z_INDEX: Record<PlayerStripSlot, number> = {
  "mount-back": -2,
  "mount-rider": -1,
  main: 0,
  "mount-front": 1,
};

interface SlotState {
  /** Pixi sprite mounted in player.container; texture pointer-swaps each tick. */
  sprite: Sprite;
  /** Pre-allocated per-frame sub-rect Textures sharing currentSource. */
  currentFrames: Texture[] | null;
  /** ImageSource wrapping the current Vello-rendered strip composite bitmap. */
  currentSource: ImageSource | null;
  /** Unused under bridge path. Retained as placeholder for type compatibility. */
  currentTextureId: number;
  /** Anim key currently INSTALLED on the sprite. */
  currentAnimKey: string;
  /**
   * Anim key MOST RECENTLY REQUESTED via `applyAnimation`. Diverges
   * from `currentAnimKey` while a bake is in flight in the queue.
   * The queue callback uses this to detect stale results (caller
   * changed mind before the strip landed) and free the GPU texture
   * immediately rather than installing it.
   */
  requestedAnimKey: string;
  /**
   * Last `applyAnimation` parameters — captured so a resolution
   * change can re-invoke Vello at the new density and swap in a
   * crisper texture without waiting for the next anim change.
   * Null until the slot has rendered its first strip.
   */
  lastAnimation: CharacterAnimation | null;
  lastAnimName: string;
  lastDir: DirSuffix;
  lastFlipped: boolean;
  /** Owning player — kept for the re-render path (needs `player.look`). */
  player: ActivePlayer | null;
}

function makeAnimKey(
  animation: CharacterAnimation,
  animName: string,
  dir: DirSuffix,
  flipped: boolean,
  look: string
): string {
  return `${animation.bundle}|${animName}|${dir}|${flipped ? "f" : "u"}|${look}`;
}

/**
 * Strip-render coordinator. One instance per Battlefield; owns the
 * sprite + texture lifecycle for every active player.
 *
 * Path B: the live `PlayerStripRenderer` export now points at the V2
 * (band-mesh + accessory-sprite) implementation in
 * `./player-strip-renderer-v2.ts`. This V1 class stays available as
 * `PlayerStripRendererLegacy` for rollback / pixel-parity tests until
 * step 11 (fork removal) deletes it.
 */
export class PlayerStripRendererLegacy {
  /** playerId → slot → SlotState. */
  private states = new Map<number, Map<PlayerStripSlot, SlotState>>();
  private resolution: number;

  constructor(_pixiRenderer: Renderer, resolution = 3) {
    // Bridge path: Pixi resource creation no longer needs the
    // renderer reference (ImageSource takes a bitmap, not a
    // device-bound renderer). Param kept for API stability.
    this.resolution = Math.max(1, resolution);
  }

  setResolution(res: number): void {
    this.resolution = Math.max(1, res);
  }

  getStats(): { players: number; slots: number } {
    let slots = 0;
    for (const m of this.states.values()) slots += m.size;
    return { players: this.states.size, slots };
  }

  /**
   * True once the slot has at least one strip installed (initial bake
   * landed). Callers that want "don't start moving / animating until
   * the bot's first sprite is on screen" poll this. Subsequent anim
   * swaps don't reset it — the slot keeps the previous strip as a
   * fallback while a new bake is in flight.
   */
  isSlotReady(playerId: number, slot: PlayerStripSlot = "main"): boolean {
    const state = this.states.get(playerId)?.get(slot);
    return !!(state?.currentSource && state.currentFrames?.length);
  }

  /**
   * Look up the live Pixi `Sprite` for a player's slot — used by the
   * picking layer to AABB+alpha-test hovers against the actual char
   * silhouette. Returns null if the slot was never attached or has
   * already been retired. The sprite's parent (player.container)
   * carries the player's screen position so callers that need it for
   * canvas-space projection can read `sprite.parent`.
   */
  getSlotSprite(playerId: number, slot: PlayerStripSlot = "main"): Sprite | null {
    return this.states.get(playerId)?.get(slot)?.sprite ?? null;
  }

  /** Idempotently mount the main slot (sprite child of player.container). */
  attach(player: ActivePlayer): void {
    if (this.states.has(player.id)) {
      return;
    }
    const slots = new Map<PlayerStripSlot, SlotState>();
    slots.set("main", this.createSlot(player, "main"));
    this.states.set(player.id, slots);
  }

  /**
   * Idempotently ensure a non-main slot exists. Used by mount-aware
   * sync to bring up `mount-back/rider/front` sprites on demand.
   */
  ensureSlot(player: ActivePlayer, slot: PlayerStripSlot): void {
    const slots = this.states.get(player.id);
    if (!slots) {
      log.warn(`ensureSlot: player ${player.id} not attached`);
      return;
    }
    if (!slots.has(slot)) {
      slots.set(slot, this.createSlot(player, slot));
    }
  }

  /**
   * Retire one slot — destroys its sprite and pairs old GPU resources
   * with the 2-tick `freeRenderTexture` settle. Called when a mount
   * sub-layer disappears (un-mount, tactic mode, etc.).
   */
  removeSlot(player: ActivePlayer, slot: PlayerStripSlot): void {
    const slots = this.states.get(player.id);
    if (!slots) {
      return;
    }
    const state = slots.get(slot);
    if (!state) {
      return;
    }
    this.retireSlotState(state);
    slots.delete(slot);
  }

  /** Toggle slot visibility — used to hide `main` when mounted. */
  setSlotVisible(
    player: ActivePlayer,
    slot: PlayerStripSlot,
    visible: boolean
  ): void {
    const state = this.states.get(player.id)?.get(slot);
    if (state) {
      state.sprite.visible = visible;
    }
  }

  /**
   * Request a strip for the given slot's animation. Routes through
   * the global per-frame-budgeted bake queue so N simultaneous
   * applyAnimation calls (spawn ramp, simultaneous walk-starts) get
   * spread across multiple rAF ticks instead of blocking the main
   * thread.
   *
   * Visible behaviour:
   *   - Same `(bundle, anim, dir, flipped, look)` as currently
   *     installed → no-op (cache hit on the slot itself).
   *   - Bake already in flight for this key (this slot or another
   *     slot's identical request) → dedup collapse; second caller
   *     gets the same strip when it lands.
   *   - Bake lands → strip installs, previous strip retires after
   *     2-tick settle. Sprite stays on the old strip in the meantime
   *     (or remains empty if this is the slot's first strip).
   *   - Bot changed mind before bake landed → stale-result detector
   *     frees the GPU texture immediately.
   */
  applyAnimation(
    player: ActivePlayer,
    slot: PlayerStripSlot,
    animation: CharacterAnimation,
    animName: string,
    dir: DirSuffix,
    flipped: boolean
  ): void {
    const state = this.states.get(player.id)?.get(slot);
    if (!state) {
      log.warn(
        `applyAnimation: player ${player.id} slot ${slot} not initialized`
      );
      return;
    }
    const key = makeAnimKey(animation, animName, dir, flipped, player.look);
    if (key === state.currentAnimKey) {
      this.applyFlipToSlot(state, flipped);
      return;
    }
    // If a bake for this same key is already in flight, the queue
    // will dedup; we just need to make sure we've staked our claim.
    // Set requestedAnimKey eagerly so a stale callback (for a key we
    // no longer want) recognises itself and frees its strip.
    state.requestedAnimKey = key;
    // Flip applies to the OLD strip while we wait — direction
    // changes that are just mirror flips (R↔SW etc.) visually align
    // with the move immediately, even though the new strip hasn't
    // landed.
    this.applyFlipToSlot(state, flipped);

    // Snapshot every arg the bake closure needs. The closure runs
    // potentially many frames after this method returns — by then
    // the bot may have changed anim, despawned, or had its look
    // mutated. Capturing primitives by value keeps the closure
    // deterministic.
    const accessoryEntries: AccessoryRenderEntry[] = animation.accessories.map(
      (a) => ({
        slot: a.slot,
        bundle: a.bundle,
        exportName: a.exportName,
        animType: a.animType,
      })
    );
    const bundle = animation.bundle;
    const exportName = animation.exportName;
    const frameCount = animation.frameCount;
    const resolution = this.resolution;
    const cz = animation.colorZones;
    const c1 = cz ? cz[0] : -1;
    const c2 = cz ? cz[1] : -1;
    const c3 = cz ? cz[2] : -1;

    const render = (): unknown => {
      // Apply this bot's color zones immediately before the render —
      // `renderSwfStripRangeAccessorized` reads global Vello state,
      // so any other consumer's setSwfPlayerColors call in between
      // would have polluted it. Pairing set+render inside the queue
      // closure keeps them atomic on the JS thread.
      setSwfPlayerColors(c1, c2, c3);
      return renderSwfStripRangeAccessorized(
        bundle,
        exportName,
        0,
        frameCount,
        frameCount,
        resolution,
        accessoryEntries,
        dir,
        flipped
      );
    };

    const callback: StripBakeCallback = (raw) => {
      const strip = raw as VelloSwfStripResult | null;
      // Stale-result guard. By the time this fires the bot may have
      // already requested a different anim, or the player container
      // may have been destroyed. Either way: free the strip if it's
      // not the one we still want, and bail.
      if (state.requestedAnimKey !== key) {
        if (strip) {
          try {
            strip.bitmap.close();
          } catch {}
        }
        return;
      }
      if (!strip) {
        // Render failed or watchdog halted — keep previous frames.
        return;
      }
      this.installStrip(
        state,
        player,
        slot,
        animation,
        animName,
        dir,
        flipped,
        strip,
        key
      );
    };

    // The wanted-check lets the queue skip stale renders entirely
    // when the bot has changed direction (or despawned) before its
    // bake reached the front of the queue. At 400 bots with churn,
    // this is the difference between draining the queue and falling
    // behind exponentially.
    getStripBakeQueue().enqueue(
      key,
      render,
      callback,
      () => state.requestedAnimKey === key,
    );
  }

  /**
   * Apply a freshly-baked strip to its slot — sets up the
   * ExternalSource, per-frame Texture views, sprite anchor + texture,
   * and retires the previous strip with the 2-tick settle. Extracted
   * from `applyAnimation` so the queue callback can call it cleanly
   * after the async wait.
   */
  private installStrip(
    state: SlotState,
    player: ActivePlayer,
    slot: PlayerStripSlot,
    animation: CharacterAnimation,
    animName: string,
    dir: DirSuffix,
    flipped: boolean,
    strip: VelloSwfStripResult,
    key: string
  ): void {
    const source = new ImageSource({
      resource: strip.bitmap,
      width: strip.width,
      height: strip.height,
      label: `player-strip-${player.id}-${slot}-${animName}`,
      alphaMode: "premultiply-alpha-on-upload",
      scaleMode: "linear",
      autoGarbageCollect: false,
    });
    uploadAndCloseBitmap(getPixiRenderer(), source, strip.bitmap);
    // NOTE: `source.resolution` is not set. Pixi treats it as a
    // pixel-density multiplier that shrinks rendered output by 1/N;
    // combined with our `sprite.scale = 1/this.resolution` that would
    // produce 1/N² (tiny chars). The compensation lives entirely in
    // sprite.scale; matches stress-worker.ts.

    const cols = strip.gridCols || strip.frameCount;
    const fw = strip.frameWidth;
    const fh = strip.frameHeight;
    const frames: Texture[] = new Array(strip.frameCount);
    for (let i = 0; i < strip.frameCount; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      frames[i] = new Texture({
        source,
        frame: new Rectangle(col * fw, row * fh, fw, fh),
      });
    }

    state.sprite.anchor.set(strip.anchorX / fw, strip.anchorY / fh);
    this.applyFlipToSlot(state, flipped);
    state.sprite.texture =
      frames[player.frameIndex % frames.length] ?? frames[0];

    // Retire previous strip after a 2-tick settle. We must destroy
    // each per-frame `Texture` wrapper explicitly — Pixi v8 keeps
    // them in internal weak/strong maps and orphaning them doesn't
    // release the underlying GPU resources. For a 24-frame strip
    // anim-swapping every 200ms, leaking those wrappers across 400
    // bots = ~50K Texture objects/min, which is where the 2GB+ RSS
    // growth comes from.
    const oldSource = state.currentSource;
    const oldFrames = state.currentFrames;
    if (oldSource) {
      this.scheduleRetire(oldFrames, oldSource);
    }

    state.currentFrames = frames;
    state.currentSource = source;
    state.currentTextureId = 0;
    state.currentAnimKey = key;
    state.lastAnimation = animation;
    state.lastAnimName = animName;
    state.lastDir = dir;
    state.lastFlipped = flipped;
    state.player = player;
  }

  /**
   * Schedule the 2-tick retire of a previous strip's resources.
   * Destroys per-frame Texture wrappers first (Pixi-internal cleanup),
   * then the ExternalSource (releases the GPU texture binding), then
   * the wgpu::Texture itself via `freeRenderTexture`.
   */
  private scheduleRetire(
    frames: Texture[] | null,
    source: ImageSource,
  ): void {
    setTimeout(() => {
      if (frames) {
        for (const t of frames) {
          // destroy(false) — don't recurse into the source; we
          // destroy it explicitly below in the right order.
          try {
            t.destroy(false);
          } catch {}
        }
      }
      // Bridge path: destroying the ImageSource cascades to Pixi's
      // uploaded GPUTexture. The Rust-side `wgpu::Texture` already
      // dropped at end of the bake and queued into deferred destroy.
      try {
        source.destroy();
      } catch {}
    }, RETIRE_DELAY_MS);
  }

  /**
   * Re-render every live slot at the new resolution so sprites stay
   * crisp across user zoom changes (Vello rasterizes from vectors so
   * up-sampling the texture is free). Invalidates the per-slot
   * `currentAnimKey` cache before replaying the last `applyAnimation`
   * call — otherwise the dedup short-circuit would skip the render
   * even though resolution changed.
   *
   * Sprite scale is bound to `1/resolution`, so we also retag every
   * sprite's local scale before the new strip lands (the texture
   * pointer swap happens inside `applyAnimation`).
   */
  setResolutionAndRerender(res: number): void {
    const clamped = Math.max(1, res);
    if (clamped === this.resolution) {
      return;
    }
    this.resolution = clamped;
    for (const slots of this.states.values()) {
      for (const [slot, state] of slots) {
        // Force the dedup key to miss so applyAnimation re-issues
        // the Vello strip render at the new density.
        state.currentAnimKey = "";
        // Sprite scale tracks the density immediately — the new
        // strip texture lands inside applyAnimation a frame later,
        // but applyFlipToSlot in the meantime keeps the math right.
        this.applyFlipToSlot(state, state.lastFlipped);
        if (state.lastAnimation && state.player) {
          this.applyAnimation(
            state.player,
            slot,
            state.lastAnimation,
            state.lastAnimName,
            state.lastDir,
            state.lastFlipped
          );
        }
      }
    }
  }

  /**
   * Update flip + scale across all live slots without re-rendering —
   * direction-only changes (R↔SW share the same export with mirror).
   */
  updateFlip(player: ActivePlayer, flipped: boolean): void {
    const slots = this.states.get(player.id);
    if (!slots) {
      return;
    }
    for (const state of slots.values()) {
      this.applyFlipToSlot(state, flipped);
    }
  }

  /**
   * Per-tick texture pointer swap across all live slots. Each slot's
   * frame array length is its own (e.g. backAnim might have a
   * different frame count than chevauchorAnim) but they share the
   * `player.frameIndex` cursor — modulo per slot keeps everyone in
   * lockstep.
   */
  swapFrame(player: ActivePlayer): void {
    const slots = this.states.get(player.id);
    if (!slots) {
      return;
    }
    const idx = player.frameIndex;
    for (const state of slots.values()) {
      if (!state.currentFrames || state.currentFrames.length === 0) {
        continue;
      }
      const i = idx % state.currentFrames.length;
      const tex = state.currentFrames[i];
      if (tex && state.sprite.texture !== tex) {
        state.sprite.texture = tex;
      }
    }
  }

  /** Drop every slot for the player + retire textures. */
  detach(player: ActivePlayer): void {
    const slots = this.states.get(player.id);
    if (!slots) {
      return;
    }
    for (const state of slots.values()) {
      this.retireSlotState(state);
    }
    this.states.delete(player.id);
  }

  /** Tear down all sprites. Map change / shutdown. */
  destroy(): void {
    for (const slots of this.states.values()) {
      for (const state of slots.values()) {
        this.retireSlotState(state);
      }
    }
    this.states.clear();
  }

  private createSlot(
    player: ActivePlayer,
    slot: PlayerStripSlot
  ): SlotState {
    const sprite = new Sprite();
    sprite.scale.set(1 / this.resolution);
    sprite.anchor.set(0, 0);
    sprite.zIndex = SLOT_Z_INDEX[slot];
    player.container.addChild(sprite);
    return {
      sprite,
      currentFrames: null,
      currentSource: null,
      currentTextureId: 0,
      currentAnimKey: "",
      requestedAnimKey: "",
      lastAnimation: null,
      lastAnimName: "",
      lastDir: "F",
      lastFlipped: false,
      player,
    };
  }

  private applyFlipToSlot(state: SlotState, flipped: boolean): void {
    const s = 1 / this.resolution;
    state.sprite.scale.set(flipped ? -s : s, s);
  }

  private retireSlotState(state: SlotState): void {
    const oldSource = state.currentSource;
    const oldFrames = state.currentFrames;
    const oldTextureId = state.currentTextureId;
    // Poison the request key so any queued bake's callback recognises
    // the slot is gone and frees its strip via the stale-result guard
    // instead of installing it on the destroyed sprite.
    state.requestedAnimKey = "<retired>";
    state.currentAnimKey = "<retired>";
    state.player = null;
    try {
      state.sprite.parent?.removeChild(state.sprite);
      state.sprite.destroy();
    } catch {}
    if (oldSource) {
      this.scheduleRetire(oldFrames, oldSource);
    }
    void oldTextureId;
  }
}
