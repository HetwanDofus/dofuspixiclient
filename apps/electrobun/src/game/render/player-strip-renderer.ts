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

interface StripState {
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
  private states = new Map<number, StripState>();
  private resolution: number;
  private pixiRenderer: Renderer;

  constructor(pixiRenderer: Renderer, resolution = 3) {
    this.pixiRenderer = pixiRenderer;
    this.resolution = Math.max(1, resolution);
  }

  setResolution(res: number): void {
    this.resolution = Math.max(1, res);
  }

  /** Idempotently mount a sprite as child of player.container. */
  attach(player: ActivePlayer): void {
    if (this.states.has(player.id)) {
      return;
    }
    const sprite = new Sprite();
    sprite.scale.set(1 / this.resolution);
    sprite.anchor.set(0, 0);
    sprite.zIndex = 0;
    player.container.addChild(sprite);
    this.states.set(player.id, {
      sprite,
      currentFrames: null,
      currentSource: null,
      currentTextureId: 0,
      currentAnimKey: "",
    });
  }

  /**
   * Render a strip for the player's current animation and replace
   * the sprite's frame array. Idempotent — same key skips work.
   * Synchronous: vello-wasm returns the GPUTexture in the same call.
   */
  applyAnimation(
    player: ActivePlayer,
    animation: CharacterAnimation,
    animName: string,
    dir: DirSuffix,
    flipped: boolean
  ): void {
    const state = this.states.get(player.id);
    if (!state) {
      log.warn(`applyAnimation: player ${player.id} not attached`);
      return;
    }
    const key = makeAnimKey(animation, animName, dir, flipped, player.look);
    if (key === state.currentAnimKey) {
      this.updateFlip(player, flipped);
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
      label: `player-strip-${player.id}-${animName}`,
    });
    source.alphaMode = "no-premultiply-alpha";
    source.format = "rgba8unorm";
    source.resolution = this.resolution;
    source.autoGarbageCollect = false;

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

    // Anchor is fraction-of-frame so sprite origin lands at SWF (0,0).
    state.sprite.anchor.set(strip.anchorX / fw, strip.anchorY / fh);
    const s = 1 / this.resolution;
    state.sprite.scale.set(flipped ? -s : s, s);
    state.sprite.texture =
      frames[player.frameIndex % frames.length] ?? frames[0];

    // Retire previous strip after a 2-tick settle so any in-flight
    // Pixi sample of the old texture lands before wgpu storage is
    // reclaimed (per `feedback_pixi_wgpu_texture_lifetime`).
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
   * Update sprite flip + scale without re-rendering — used when the
   * direction changes but the underlying anim export is unchanged
   * (R↔SW reuses the R strip with horizontal flip).
   */
  updateFlip(player: ActivePlayer, flipped: boolean): void {
    const state = this.states.get(player.id);
    if (!state) {
      return;
    }
    const s = 1 / this.resolution;
    state.sprite.scale.set(flipped ? -s : s, s);
  }

  /**
   * Per-tick texture pointer swap. Reads `player.frameIndex` (advanced
   * by sprite-controller.tickFrame) and updates the sprite's texture
   * to the corresponding strip frame. Zero allocation.
   */
  swapFrame(player: ActivePlayer): void {
    const state = this.states.get(player.id);
    if (!state || !state.currentFrames || state.currentFrames.length === 0) {
      return;
    }
    const idx = player.frameIndex % state.currentFrames.length;
    const tex = state.currentFrames[idx];
    if (tex && state.sprite.texture !== tex) {
      state.sprite.texture = tex;
    }
  }

  /** Drop the player's strip + retire textures. */
  detach(player: ActivePlayer): void {
    const state = this.states.get(player.id);
    if (!state) {
      return;
    }
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
    this.states.delete(player.id);
  }

  /** Tear down all sprites. Map change / shutdown. */
  destroy(): void {
    for (const [, state] of this.states) {
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
    this.states.clear();
  }
}
