/**
 * Spell 1104 - Unknown Spell
 *
 * A composite animation spell that plays a single sprite animation.
 * The animation contains internal sprites (DefineSprite_4 and DefineSprite_5) 
 * with randomized start frames that loop.
 *
 * Components:
 * - anim1: Main composite animation at caster position
 *
 * Original AS timing:
 * - Frame 1: Play sound "autre_1104"
 * - Frame 137: Signal hit (this.end())
 * - Frame 159: Complete animation
 * - DefineSprite_4: Random start between frames 2-41, loops at frame 95 back to 44
 * - DefineSprite_5: Random start between frames 2-41, loops at frame 85 back to 56
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 599.7,
  height: 354.3,
  offsetX: -299.7,
  offsetY: -121.5,
};

export class Spell1104 extends BaseSpell {
  readonly spellId = 1104;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(ANIM1_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(0, init.casterY);
    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('autre_1104'))
      .onFrame(136, () => this.signalHit());
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