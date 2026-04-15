import type {
  ISpellAnimation,
  SpellCallbacks,
  SpellContext,
} from "@dofus/spell-runtime";
import { Container, Sprite, type Texture } from "pixi.js";

import type { LoadedSpell } from "@/game/assets/spell-asset-loader";

/** Fade-out duration after the animation reaches its stop frame. */
const FADE_MS = 500;

const DEFAULT_FPS = 60;

/**
 * Steps through a spell's pre-rendered frame textures, fires sounds at the
 * author-marked frames, signals hit + fades out at the stop frame.
 *
 * Used when `manifest.spell.requiresTypeScript` is false — i.e. the spell
 * doesn't need custom particle/physics code and can play like a GIF.
 */
export class PreRenderedSpell implements ISpellAnimation {
  readonly container = new Container();
  private sprite: Sprite | null = null;
  private textures: Texture[] = [];
  private frameMs = 1000 / DEFAULT_FPS;
  private frameAccumulator = 0;
  private currentFrame = 0;
  private stopFrame = 0;
  private stopped = false;
  private fadeElapsed = 0;
  private fading = false;
  private done = false;
  private sounds: Array<{ frame: number; soundId: string }> = [];
  private firedSounds = new Set<number>();
  private callbacks!: SpellCallbacks;
  private hitSignaled = false;

  constructor(
    readonly spellId: number,
    loaded: LoadedSpell
  ) {
    // Prefer 'anim1' (Dofus convention) else the first animation available.
    const animNames = Object.keys(loaded.manifest.animations);
    const mainName = animNames.includes("anim1") ? "anim1" : animNames[0];

    if (!mainName) {
      return;
    }

    const frames = loaded.textures.getFrames(mainName);

    if (frames.length === 0) {
      return;
    }

    this.textures = frames;
    this.frameMs = 1000 / (loaded.manifest.spell.fps || DEFAULT_FPS);

    const animMeta = loaded.manifest.spell.animationMeta?.[mainName];
    const lastFrame = frames.length - 1;
    this.stopFrame = animMeta?.stopFrame ?? lastFrame;

    this.sounds = [...loaded.manifest.spell.sounds];

    const sprite = new Sprite(frames[0]);

    // Anchor so the manifest's offset positions the sprite relative to the target cell.
    const animEntry = loaded.manifest.animations[mainName];

    if (animEntry && animEntry.width > 0 && animEntry.height > 0) {
      sprite.anchor.set(
        -animEntry.offsetX / animEntry.width,
        -animEntry.offsetY / animEntry.height
      );
    }

    sprite.scale.set(loaded.manifest.spell.mainTimelineScale || 1);
    this.sprite = sprite;
    this.container.addChild(sprite);
  }

  init(_context: SpellContext, callbacks: SpellCallbacks): void {
    this.callbacks = callbacks;

    // Sounds on frame 0 fire immediately.
    for (const sound of this.sounds) {
      if (sound.frame === 0) {
        this.callbacks.playSound(sound.soundId);
        this.firedSounds.add(sound.frame);
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    if (this.fading) {
      this.fadeElapsed += deltaTime;
      const t = Math.min(1, this.fadeElapsed / FADE_MS);

      if (this.sprite) {
        this.sprite.alpha = 1 - t;
      }

      if (t >= 1) {
        this.done = true;
        this.callbacks.onComplete();
      }

      return;
    }

    if (this.stopped) {
      if (!this.hitSignaled) {
        this.hitSignaled = true;
        this.callbacks.onHit();
      }

      this.fading = true;
      return;
    }

    this.advanceFrames(deltaTime);
  }

  isComplete(): boolean {
    return this.done;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }

  private advanceFrames(deltaTime: number): void {
    this.frameAccumulator += deltaTime;

    while (this.frameAccumulator >= this.frameMs) {
      this.frameAccumulator -= this.frameMs;
      this.currentFrame++;

      this.fireSoundsForFrame(this.currentFrame);

      if (this.currentFrame >= this.stopFrame) {
        this.currentFrame = this.stopFrame;
        this.stopped = true;
        this.swapTexture();
        return;
      }

      this.swapTexture();
    }
  }

  private fireSoundsForFrame(frame: number): void {
    for (const sound of this.sounds) {
      if (sound.frame === frame && !this.firedSounds.has(sound.frame)) {
        this.firedSounds.add(sound.frame);
        this.callbacks.playSound(sound.soundId);
      }
    }
  }

  private swapTexture(): void {
    if (this.sprite && this.textures[this.currentFrame]) {
      this.sprite.texture = this.textures[this.currentFrame];
    }
  }
}
