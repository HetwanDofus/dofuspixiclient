/**
 * Spell 603 - Dodge
 *
 * A dodge/evasion effect with spiraling particles.
 *
 * Components:
 * - anim1: Main composite animation at target position, stops at frame 219
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'dodge_603'
 * - Frame 145 (DefineSprite_20): Signal hit (this.end())
 * - Frame 220 (DefineSprite_20): removeMovieClip / stop
 *
 * The animation is a composite (isComposite: true) with 222 frames,
 * stopping at frame 219 (0-indexed).
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 43.25,
  height: 34.75,
  offsetX: -22.6,
  offsetY: -15.8,
};

export class Spell603 extends BaseSpell {
  readonly spellId = 603;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      stopFrame: 219,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('dodge_603'));

    // Frame 145 (0-indexed: 144): Signal hit (DefineSprite_20 frame_145: this.end())
    this.mainAnim.onFrame(144, () => this.signalHit());

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
