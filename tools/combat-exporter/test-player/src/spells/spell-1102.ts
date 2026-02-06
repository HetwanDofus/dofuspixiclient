/**
 * Spell 1102 - Unknown Name
 *
 * A simple single-animation spell effect.
 *
 * Components:
 * - anim1: Main animation at caster position
 *
 * Original AS timing:
 * - Frame 1: Play sound "aute_1102"
 * - Frame 137: Signal hit (this.end())
 * - Frame 159: Remove movie clip
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 1340.6999999999998,
  height: 1062.3000000000002,
  offsetX: -818.0999999999999,
  offsetY: -738,
};

export class Spell1102 extends BaseSpell {
  readonly spellId = 1102;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Main animation at caster position
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(0, init.casterY);
    this.mainAnim
      .stopAt(104) // AS frame 105 (0-indexed)
      .onFrame(0, () => this.callbacks.playSound('aute_1102')) // AS frame 1
      .onFrame(136, () => this.signalHit()); // AS frame 137
    
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete at frame 159 (0-indexed: 158)
    if (this.mainAnim.getFrame() >= 158) {
      this.complete();
    }
  }
}