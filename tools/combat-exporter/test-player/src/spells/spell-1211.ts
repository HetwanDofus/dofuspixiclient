/**
 * Spell 1211 - Impact Lourd
 *
 * A falling weight effect that bounces and fades.
 *
 * Components:
 * - anim1: Composite animation at target position, stops at frame 78
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_22): Play sound 'impact_lourd'
 * - Frame 79 (DefineSprite_28): stop() + removeMovieClip() - animation ends
 *
 * DefineSprite_27: Falling weight with bounce physics
 * - Random scale: 50 + random(50) %
 * - Random target height: -20 + random(40)
 * - Gravity: g = 0.5, bounce coefficient: 0.3
 * - Alpha: starts at 1.67, increases by 5 per frame until bounce, then -3.34
 *
 * DefineSprite_26: Smoke puff - stops immediately (stop() on frame 1)
 *
 * DefineSprite_25: Smoke particle
 * - vx = 1.67 + random(1.67) (onClipEvent load)
 * - _X += vx; vx *= 0.97 (onClipEvent enterFrame)
 * - va = 1.67 + random(1.67); t = 50 + random(50); random rotation
 * - alpha decreases by va each frame
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 87.9,
  height: 78.95,
  offsetX: -43.15,
  offsetY: -173.05,
};

export class Spell1211 extends BaseSpell {
  readonly spellId = 1211;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      stopFrame: 78,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound 'impact_lourd'
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound('impact_lourd');
    });

    // Signal hit at frame 0 when the impact sound plays
    this.mainAnim.onFrame(0, () => {
      this.signalHit();
    });

    this.container.addChild(this.mainAnim.sprite);
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
