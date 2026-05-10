import type {
  ISpellAnimation,
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
} from "@dofus/spell-runtime";
import {
  Container,
  ExternalSource,
  type Renderer,
  Sprite,
  Texture,
} from "pixi.js";

import type { LoadedSpell } from "@/game/assets/spell-asset-loader";
import {
  createSwfSpellInstance,
  disposeSwfSpellInstance,
  setSwfSpellHostCell,
  setSwfSpellHostNumber,
  tickSwfSpellFrame,
} from "@/game/render/vello-loader";
import { createLogger } from "@/utils/logger";

const log = createLogger("LiveSwfSpell");

const FADE_MS = 500;
const DEFAULT_FPS = 24;

/**
 * Wiring context for a single spell cast — supplied by `SpellRenderer`
 * so the cast can mount its Pixi sprite into the canonical Object2
 * parent at the right per-cell sub-offset. The anchor position itself
 * comes from `context.anchor` inside `init()` since runtime spells'
 * `displayType` may shift it relative to caller.
 */
export interface SpellWorldCtx {
  /** Pixi renderer needed to wrap the AVM1 instance's GPUTexture. */
  pixiRenderer: Renderer;
  /** Container the spell sprite mounts into (battlefield's objectLayer2). */
  parent: Container;
  /** Stable id (kept for diagnostics; spell sprites manage their own lifetime). */
  placementId: string;
  /** Canonical depth `cellNum × 100 + 50 + sign × index` (zIndex on the sprite). */
  depth: number;
  /** Vello rasterization resolution applied to the AVM1 strip. */
  resolution: number;
}

/**
 * Drives a spell visual by ticking its SWF + AVM1 emulator live, frame
 * by frame, instead of replaying a pre-baked strip. Each cast holds a
 * dedicated `AvmRenderer` instance in WASM whose state (current frame,
 * `_alpha`, `_rotation`, etc.) survives across ticks. Host inputs
 * (`cellFrom` / `cellTo` / `level` / `angle`) flow in once at init;
 * AS2 outputs (`stop()` → `isPlaying=false`, `_parent.removeMovieClip()`
 * → `isRemoved=true`) flow back in the per-tick result.
 *
 * **Render path**: with Vello + Pixi sharing a GPUDevice (Phase 2 of
 * the render migration), the AVM1 instance's pre-allocated output
 * texture is wrapped as a Pixi `ExternalSource` once at init. Each
 * tick `tickSwfSpellFrame` advances AVM1 + writes new pixels into the
 * same handle; we call `source.updateGPUTexture(...)` to invalidate
 * Pixi's cached state so the next render samples the new content.
 * No per-cast worldLayer dispatch; one Pixi sprite per cast composes
 * naturally with the rest of the scene.
 */
export class PreRenderedSpell implements ISpellAnimation {
  /**
   * Empty Pixi container kept for `ISpellAnimation` interface
   * compatibility — `spell-view.runSpell` reads `.position` on it for
   * the legacy harness path. The actual visual sprite is mounted
   * directly into `worldCtx.parent` at `worldCtx.depth`.
   */
  readonly container = new Container();

  private instanceId = 0;
  private readonly bundleName: string;
  private readonly worldCtx: SpellWorldCtx;

  private frameAccumulator = 0;
  private readonly frameMs: number;
  private fadeElapsed = 0;
  private fading = false;
  private done = false;
  private hitSignaled = false;
  private callbacks!: SpellCallbacks;

  private sprite: Sprite | null = null;
  private source: ExternalSource | null = null;
  private alpha = 1;

  constructor(
    readonly spellId: number,
    loaded: LoadedSpell,
    worldCtx: SpellWorldCtx
  ) {
    this.bundleName = loaded.bundleName;
    this.frameMs = 1000 / (loaded.fps || DEFAULT_FPS);
    this.worldCtx = worldCtx;
  }

  init(
    context: SpellContext,
    callbacks: SpellCallbacks,
    _textures: SpellTextureProvider
  ): void {
    this.callbacks = callbacks;

    if (!this.bundleName) {
      this.complete();
      return;
    }

    this.instanceId = createSwfSpellInstance(
      this.bundleName,
      this.worldCtx.resolution
    );
    if (this.instanceId === 0) {
      log.warn(`spell ${this.spellId}: createSwfSpellInstance returned 0`);
      this.complete();
      return;
    }

    // Push canonical Dofus 1.29 host vars into the AVM1 root before the
    // first tick. AS2 lookups like `_parent.cellFrom.x` resolve against
    // these. `level` / `angle` mirror what `VisualEffectHandler.as`
    // pushed before invoking the spell SWF.
    setSwfSpellHostCell(
      this.instanceId,
      "cellFrom",
      context.cellFrom.x,
      context.cellFrom.y
    );
    setSwfSpellHostCell(
      this.instanceId,
      "cellTo",
      context.cellTo.x,
      context.cellTo.y
    );
    setSwfSpellHostNumber(this.instanceId, "level", context.level);
    setSwfSpellHostNumber(this.instanceId, "angle", context.angle);
    setSwfSpellHostNumber(
      this.instanceId,
      "distance",
      Math.round(context.distance ?? 0)
    );
    setSwfSpellHostNumber(
      this.instanceId,
      "isCritical",
      context.isCritical ? 1 : 0
    );

    // Tick once so AVM1 has rendered an initial frame and the cast's
    // pre-allocated GPU texture has valid pixels — wrap that as a
    // Pixi ExternalSource and mount the sprite at the canonical
    // anchor + depth.
    const first = tickSwfSpellFrame(this.instanceId);
    if (!first) {
      this.complete();
      return;
    }

    this.source = new ExternalSource({
      resource: first.texture,
      renderer: this.worldCtx.pixiRenderer,
      width: first.width,
      height: first.height,
      label: `spell-${this.spellId}-${this.instanceId}`,
    });
    this.source.alphaMode = "no-premultiply-alpha";
    this.source.format = "rgba8unorm";
    this.source.resolution = this.worldCtx.resolution;
    this.source.autoGarbageCollect = false;

    const sprite = new Sprite(new Texture({ source: this.source }));
    sprite.anchor.set(
      first.width > 0 ? first.anchorX / first.width : 0,
      first.height > 0 ? first.anchorY / first.height : 0
    );
    const s = 1 / this.worldCtx.resolution;
    sprite.scale.set(s, s);
    // Anchor at `context.anchor` (logical world coords); runtime
    // spells' `displayType` already shifts this in spell-view's
    // buildSpellContext before we get here.
    sprite.x = context.anchor.x;
    sprite.y = context.anchor.y;
    sprite.zIndex = this.worldCtx.depth;
    sprite.alpha = this.alpha;
    this.worldCtx.parent.addChild(sprite);
    this.sprite = sprite;

    if (first.isRemoved) {
      this.complete();
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    if (this.fading) {
      this.fadeElapsed += deltaTime;
      const t = Math.min(1, this.fadeElapsed / FADE_MS);
      this.alpha = 1 - t;
      if (this.sprite) {
        this.sprite.alpha = this.alpha;
      }
      if (t >= 1) {
        this.complete();
      }
      return;
    }

    if (this.instanceId === 0) {
      return;
    }

    this.frameAccumulator += deltaTime;
    while (
      this.frameAccumulator >= this.frameMs &&
      !this.done &&
      !this.fading
    ) {
      this.frameAccumulator -= this.frameMs;
      const frame = tickSwfSpellFrame(this.instanceId);
      if (!frame) {
        this.complete();
        return;
      }
      // AVM1 advanced. The texture handle may stay the same (the
      // instance owns a pre-allocated target) or change if the cast's
      // bounds shifted — `updateGPUTexture` covers both cases and
      // forces Pixi to re-validate the source so the next render
      // samples the freshly-written pixels.
      if (this.source) {
        this.source.updateGPUTexture(frame.texture, frame.width, frame.height);
      }
      if (this.sprite) {
        this.sprite.anchor.set(
          frame.width > 0 ? frame.anchorX / frame.width : 0,
          frame.height > 0 ? frame.anchorY / frame.height : 0
        );
      }
      if (frame.isRemoved) {
        if (!this.hitSignaled) {
          this.hitSignaled = true;
          this.callbacks.onHit();
        }
        this.complete();
        return;
      }
      if (!frame.isPlaying && !this.hitSignaled) {
        // AS2 hit `stop()` — the visual peak / impact moment. Signal
        // hit, kick off the fade-out, then complete after FADE_MS.
        this.hitSignaled = true;
        this.callbacks.onHit();
        this.fading = true;
        return;
      }
    }
  }

  isComplete(): boolean {
    return this.done;
  }

  destroy(): void {
    this.disposeVisuals();
    if (this.instanceId !== 0) {
      disposeSwfSpellInstance(this.instanceId);
      this.instanceId = 0;
    }
    this.container.destroy({ children: true });
  }

  private complete(): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.disposeVisuals();
    if (this.instanceId !== 0) {
      disposeSwfSpellInstance(this.instanceId);
      this.instanceId = 0;
    }
    this.callbacks?.onComplete();
  }

  private disposeVisuals(): void {
    if (this.sprite) {
      try {
        this.sprite.parent?.removeChild(this.sprite);
        this.sprite.destroy();
      } catch {}
      this.sprite = null;
    }
    if (this.source) {
      try {
        this.source.destroy();
      } catch {}
      this.source = null;
    }
    // Note: the AVM1 instance's GPU texture is freed by
    // `disposeSwfSpellInstance` (the JS side never calls
    // `freeRenderTexture` on it directly).
  }
}
