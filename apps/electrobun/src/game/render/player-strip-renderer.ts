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
  ExternalSource,
  Rectangle,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import type { CharacterAnimation } from "@/game/assets/character-sprite";
import type { ActivePlayer } from "@/game/scene/player/types";
import {
  type AccessoryRenderEntry,
  freeRenderTexture,
  renderSwfStripRangeAccessorized,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("PlayerStripRenderer");

const TICK_INTERVAL_MS = 1000 / 60;
const RETIRE_DELAY_MS = 2 * TICK_INTERVAL_MS;

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
  /** ExternalSource wrapping the current Vello-rendered strip composite. */
  currentSource: ExternalSource | null;
  /** wgpu textureId for the strip composite (paired with freeRenderTexture). */
  currentTextureId: number;
  /** De-duplication key — same anim+look+direction skips re-render. */
  currentAnimKey: string;
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
 */
export class PlayerStripRenderer {
  /** playerId → slot → SlotState. */
  private states = new Map<number, Map<PlayerStripSlot, SlotState>>();
  private resolution: number;
  private pixiRenderer: Renderer;

  constructor(pixiRenderer: Renderer, resolution = 3) {
    this.pixiRenderer = pixiRenderer;
    this.resolution = Math.max(1, resolution);
  }

  setResolution(res: number): void {
    this.resolution = Math.max(1, res);
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
   * Render a strip for the given slot's animation and replace the
   * sprite's frame array. Idempotent — same key skips work.
   * Synchronous: vello-wasm returns the GPUTexture in the same call.
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

    const accessoryEntries: AccessoryRenderEntry[] = animation.accessories.map(
      (a) => ({
        slot: a.slot,
        bundle: a.bundle,
        exportName: a.exportName,
        animType: a.animType,
      })
    );

    const strip = renderSwfStripRangeAccessorized(
      animation.bundle,
      animation.exportName,
      0,
      animation.frameCount,
      animation.frameCount,
      this.resolution,
      accessoryEntries,
      dir,
      flipped
    );

    if (!strip) {
      // Halted or render failed — keep the previous frames showing.
      return;
    }

    const source = new ExternalSource({
      resource: strip.texture,
      renderer: this.pixiRenderer,
      width: strip.width,
      height: strip.height,
      label: `player-strip-${player.id}-${slot}-${animName}`,
    });
    source.alphaMode = "no-premultiply-alpha";
    source.format = "rgba8unorm";
    source.scaleMode = "linear";
    source.autoGarbageCollect = false;
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

    // Retire previous strip after a 2-tick settle.
    const oldSource = state.currentSource;
    const oldTextureId = state.currentTextureId;
    if (oldSource && oldTextureId) {
      setTimeout(() => {
        try {
          oldSource.destroy();
        } catch {}
        freeRenderTexture(oldTextureId);
      }, RETIRE_DELAY_MS);
    }

    state.currentFrames = frames;
    state.currentSource = source;
    state.currentTextureId = strip.textureId;
    state.currentAnimKey = key;
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
    };
  }

  private applyFlipToSlot(state: SlotState, flipped: boolean): void {
    const s = 1 / this.resolution;
    state.sprite.scale.set(flipped ? -s : s, s);
  }

  private retireSlotState(state: SlotState): void {
    const oldSource = state.currentSource;
    const oldTextureId = state.currentTextureId;
    try {
      state.sprite.parent?.removeChild(state.sprite);
      state.sprite.destroy();
    } catch {}
    if (oldSource && oldTextureId) {
      setTimeout(() => {
        try {
          oldSource.destroy();
        } catch {}
        freeRenderTexture(oldTextureId);
      }, RETIRE_DELAY_MS);
    }
  }
}
