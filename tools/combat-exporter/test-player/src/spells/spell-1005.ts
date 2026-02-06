/**
 * Spell 1005 - Crockette (Eniripsa)
 *
 * Radial explosion effect with 32 randomized ray instances.
 *
 * Each ray:
 * - Starts at random frame (1-90)
 * - Has random scale (10-70%)
 * - Has random alpha (30-100%)
 * - Positioned using Flash transform matrix
 *
 * Timing:
 * - Frame 90: Play sound (first ray to reach it)
 * - Frame 99: Signal hit
 * - Frame 147: Stop
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  decomposeFlashTransform,
  type FlashTransform,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const RAY_MANIFEST: SpriteManifest = {
  width: 796.2,
  height: 215.4,
  offsetX: -796.2,
  offsetY: -123.9,
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
    const rayTextures = textures.getFrames('sprite_23');
    const anchor = calculateAnchor(RAY_MANIFEST);

    // Container for rays, scaled for extraction scale
    this.raysContainer = new Container();
    this.raysContainer.scale.set(init.scale);
    this.raysContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.raysContainer);

    // Track which ray starts latest (will be used for hit signal)
    let latestStartFrame = -1;
    let latestRay: FrameAnimatedSprite | null = null;

    for (const transform of RAY_TRANSFORMS) {
      // Random start frame (AS: gotoAndPlay(random(90) + 2) -> 0-indexed: 1-90)
      const startFrame = Math.floor(Math.random() * 90) + 1;

      // Random scale (AS: t = 10 + random(60) -> 10-70%)
      const asScale = (10 + Math.floor(Math.random() * 60)) / 100;

      // Random alpha (AS: _alpha = 30 + random(70) -> 30-100%)
      const alpha = (30 + Math.floor(Math.random() * 70)) / 100;

      const anim = this.anims.add(new FrameAnimatedSprite({
        textures: rayTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        startFrame,
      }));

      // Apply Flash transform
      const decomposed = decomposeFlashTransform(transform);
      anim.sprite.position.set(decomposed.x, decomposed.y);
      anim.sprite.rotation = decomposed.rotation;
      anim.sprite.scale.set(decomposed.scaleX * asScale, decomposed.scaleY * asScale);
      anim.sprite.alpha = alpha;

      anim
        .stopAt(147)
        .onFrame(90, () => this.callbacks.playSound('crockette_1005'));

      this.raysContainer.addChild(anim.sprite);

      if (startFrame > latestStartFrame) {
        latestStartFrame = startFrame;
        latestRay = anim;
      }
    }

    // The ray that starts latest signals hit at frame 99
    if (latestRay) {
      latestRay.onFrame(99, () => this.signalHit());
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
