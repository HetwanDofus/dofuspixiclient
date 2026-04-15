/**
 * Spell 602 - Dodge
 *
 * An evasion/dodge animation with spiraling particle effects.
 *
 * Components:
 * - anim1 (DefineSprite_14): Main composite animation at target position
 *   - Contains spiraling orb particles (DefineSprite_13) with sinusoidal motion
 *   - Contains scale-pulsing sprites (DefineSprite_10) with random rotation/alpha
 *   - Contains randomly-scaled sprites (DefineSprite_9)
 *   - Contains bouncing sprites (DefineSprite_3) with gravity
 *   - Contains randomly-alpha-flickering sprite (DefineSprite_12)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'dodge_602'
 * - Frame 157 (DefineSprite_14): this.end() - signal hit
 * - Frame 241 (DefineSprite_14): removeMovieClip() / stop() - animation ends
 * - stopFrame: 240 (0-indexed)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 46.35,
  height: 29.35,
  offsetX: -22.6,
  offsetY: -15.1,
};

export class Spell602 extends BaseSpell {
  readonly spellId = 602;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      stopFrame: 240,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('dodge_602'))
      .onFrame(156, () => this.signalHit());

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
