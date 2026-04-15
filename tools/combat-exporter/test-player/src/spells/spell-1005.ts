/**
 * Spell 1005 - Crockette (Eniripsa)
 *
 * Radial explosion effect with 32 randomized ray instances.
 *
 * Each ray (DefineSprite_23):
 * - Starts at random frame (random(90) + 2 → 0-indexed: random frame 1-90)
 * - Has random scale t = 10 + random(60) → 10-69%
 * - Has random alpha 30 + random(70) → 30-99%
 * - Stops at frame 148 (0-indexed: 147)
 *
 * Container (DefineSprite_24):
 * - Frame 100 (0-indexed: 99): this.end() → signalHit
 * - Frame 154 (0-indexed: 153): removeMovieClip / stop → complete
 *
 * Manifest: anim1 is the composite pre-rendered animation (156 frames, stopFrame 153)
 * The sprite uses anim1 frames directly (composite render of all 32 rays).
 *
 * Original AS timing:
 * - DefineSprite_23/frame_1: gotoAndPlay(random(90)+2), set t and _alpha
 * - DefineSprite_23/frame_91: SOMA.playSound("crockette_1005")
 * - DefineSprite_23/frame_148: stop()
 * - DefineSprite_24/frame_100: this.end() → signal hit
 * - DefineSprite_24/frame_154: _parent.removeMovieClip(); stop() → complete
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  decomposeFlashTransform,
  type FlashTransform,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const RAY_MANIFEST: SpriteManifest = {
  width: 266.6,
  height: 268.05,
  offsetX: -133.85,
  offsetY: -162,
};

const RAY_TRANSFORMS: FlashTransform[] = [
  { scaleX: 1, scaleY: 1, rotateSkew0: 0, rotateSkew1: 0, translateX: -132.7, translateY: -48.65 },
  { scaleX: 0.707, scaleY: 0.707, rotateSkew0: 0.707, rotateSkew1: -0.707, translateX: -79.25, translateY: -136.45 },
  { scaleX: 0.259, scaleY: 0.259, rotateSkew0: 0.966, rotateSkew1: -0.966, translateX: -14.35, translateY: -161.5 },
  { scaleX: -0.5, scaleY: -0.5, rotateSkew0: 0.866, rotateSkew1: -0.866, translateX: 84.3, translateY: -132.55 },
  { scaleX: -1, scaleY: -1, rotateSkew0: 0, rotateSkew1: 0, translateX: 132.75, translateY: -7.3 },
  { scaleX: -0.707, scaleY: -0.707, rotateSkew0: -0.707, rotateSkew1: 0.707, translateX: 79.3, translateY: 80.5 },
  { scaleX: 0.068, scaleY: 0.068, rotateSkew0: -0.996, rotateSkew1: 0.996, translateX: -29.5, translateY: 102.85 },
  { scaleX: 0.673, scaleY: 0.673, rotateSkew0: -0.735, rotateSkew1: 0.735, translateX: -104.45, translateY: 55.75 },
  { scaleX: 0.94, scaleY: 0.94, rotateSkew0: 0.342, rotateSkew1: -0.342, translateX: -117.65, translateY: -92.8 },
  { scaleX: 0.423, scaleY: 0.423, rotateSkew0: 0.906, rotateSkew1: -0.906, translateX: -37.35, translateY: -157 },
  { scaleX: -0.087, scaleY: -0.087, rotateSkew0: 0.996, rotateSkew1: -0.996, translateX: 32.2, translateY: -158.35 },
  { scaleX: -0.766, scaleY: -0.766, rotateSkew0: 0.643, rotateSkew1: -0.643, translateX: 115, translateY: -97.45 },
  { scaleX: -0.94, scaleY: -0.94, rotateSkew0: -0.342, rotateSkew1: 0.342, translateX: 117.7, translateY: 36.85 },
  { scaleX: -0.423, scaleY: -0.423, rotateSkew0: -0.906, rotateSkew1: 0.906, translateX: 37.4, translateY: 101.05 },
  { scaleX: 0.404, scaleY: 0.404, rotateSkew0: -0.913, rotateSkew1: 0.913, translateX: -72.45, translateY: 84.85 },
  { scaleX: 0.884, scaleY: 0.884, rotateSkew0: -0.461, rotateSkew1: 0.461, translateX: -126.75, translateY: 14.95 },
  { scaleX: 0.94, scaleY: 0.94, rotateSkew0: 0.342, rotateSkew1: -0.342, translateX: -117.65, translateY: -92.8 },
  { scaleX: 0.423, scaleY: 0.423, rotateSkew0: 0.906, rotateSkew1: -0.906, translateX: -37.35, translateY: -157 },
  { scaleX: -0.087, scaleY: -0.087, rotateSkew0: 0.996, rotateSkew1: -0.996, translateX: 32.15, translateY: -158.35 },
  { scaleX: -0.766, scaleY: -0.766, rotateSkew0: 0.643, rotateSkew1: -0.643, translateX: 114.95, translateY: -97.45 },
  { scaleX: -0.94, scaleY: -0.94, rotateSkew0: -0.342, rotateSkew1: 0.342, translateX: 117.65, translateY: 36.85 },
  { scaleX: -0.423, scaleY: -0.423, rotateSkew0: -0.906, rotateSkew1: 0.906, translateX: 37.35, translateY: 101.05 },
  { scaleX: 0.404, scaleY: 0.404, rotateSkew0: -0.913, rotateSkew1: 0.913, translateX: -72.5, translateY: 84.85 },
  { scaleX: 0.884, scaleY: 0.884, rotateSkew0: -0.461, rotateSkew1: 0.461, translateX: -126.8, translateY: 14.95 },
  { scaleX: 0.766, scaleY: 0.766, rotateSkew0: 0.643, rotateSkew1: -0.643, translateX: -88.4, translateY: -129.1 },
  { scaleX: 0.087, scaleY: 0.087, rotateSkew0: 0.996, rotateSkew1: -0.996, translateX: 9, translateY: -162 },
  { scaleX: -0.423, scaleY: -0.423, rotateSkew0: 0.906, rotateSkew1: -0.906, translateX: 74.8, translateY: -139.5 },
  { scaleX: -0.94, scaleY: -0.94, rotateSkew0: 0.342, rotateSkew1: -0.342, translateX: 131.75, translateY: -53.95 },
  { scaleX: -0.766, scaleY: -0.766, rotateSkew0: -0.643, rotateSkew1: 0.643, translateX: 88.4, translateY: 73.15 },
  { scaleX: -0.087, scaleY: -0.087, rotateSkew0: -0.996, rotateSkew1: 0.996, translateX: -9, translateY: 106.05 },
  { scaleX: 0.692, scaleY: 0.692, rotateSkew0: -0.72, rotateSkew1: 0.72, translateX: -106.7, translateY: 53.25 },
  { scaleX: 0.988, scaleY: 0.988, rotateSkew0: -0.131, rotateSkew1: 0.131, translateX: -133.85, translateY: -31 },
];

export class Spell1005 extends BaseSpell {
  readonly spellId = 1005;

  private raysContainer!: Container;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const rayTextures = textures.getFrames('anim1');
    const anchor = calculateAnchor(RAY_MANIFEST);

    // Container for all rays, positioned at target
    this.raysContainer = new Container();
    this.raysContainer.scale.set(init.scale);
    this.raysContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.raysContainer);

    // Track which ray reaches frame 99 last (latest startFrame)
    // so only one sound fires and hit is signaled correctly
    let latestStartFrame = -1;
    let latestRay: FrameAnimatedSprite | null = null;

    for (const transform of RAY_TRANSFORMS) {
      // AS: gotoAndPlay(random(90) + 2) → 1-indexed frame 2-91 → 0-indexed 1-90
      const startFrame = Math.floor(Math.random() * 90) + 1;

      // AS: t = 10 + random(60) → 10-69
      const t = 10 + Math.floor(Math.random() * 60);

      // AS: _alpha = 30 + random(70) → 30-99 (as percentage, convert to 0-1)
      const alpha = (30 + Math.floor(Math.random() * 70)) / 100;

      const anim = this.anims.add(new FrameAnimatedSprite({
        textures: rayTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        startFrame,
      }));

      // Apply Flash transform from layout
      const decomposed = decomposeFlashTransform(transform);
      // Apply the per-ray random scale (t as percentage) on top of transform scale
      const asScale = t / 100;
      anim.sprite.position.set(decomposed.x, decomposed.y);
      anim.sprite.rotation = decomposed.rotation;
      anim.sprite.scale.set(decomposed.scaleX * asScale, decomposed.scaleY * asScale);
      anim.sprite.alpha = alpha;

      // AS: frame_91 (0-indexed: 90): SOMA.playSound("crockette_1005")
      anim.onFrame(90, () => this.callbacks.playSound('crockette_1005'));

      // AS: frame_148 (0-indexed: 147): stop()
      anim.stopAt(147);

      this.raysContainer.addChild(anim.sprite);

      // Track the ray with the latest startFrame for hit signal
      if (startFrame > latestStartFrame) {
        latestStartFrame = startFrame;
        latestRay = anim;
      }
    }

    // AS: DefineSprite_24/frame_100 (0-indexed: 99): this.end() → signalHit
    // Apply to the ray that starts latest (will reach frame 99 last)
    if (latestRay) {
      latestRay.onFrame(99, () => this.signalHit());
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // AS: DefineSprite_24/frame_154 (0-indexed: 153): stop() → complete
    // All rays stop at frame 147; when all are stopped, animation is done
    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
