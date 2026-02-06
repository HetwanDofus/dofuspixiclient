/**
 * Spell 104 - Tremblement
 *
 * A ground-based tremor spell with rotating visual effects.
 *
 * Components:
 * - anim1: Main animation with embedded rotation and particle effects at target position
 *
 * Original AS timing:
 * - Frame 1: Play sound "arty_104"
 * - Frame 130: Signal end (this.end())
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 1133.6999999999998,
  height: 1144.8000000000002,
  offsetX: -547.8,
  offsetY: -765.9000000000001,
};

export class Spell104 extends BaseSpell {
  readonly spellId = 104;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation at target position
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(ANIM1_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('arty_104'))
      .onFrame(129, () => this.signalHit());
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}