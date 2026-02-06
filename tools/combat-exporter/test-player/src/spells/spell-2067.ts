/**
 * Spell 2067 - Unknown
 *
 * A projectile spell with a single shoot animation that travels to target.
 *
 * Components:
 * - shoot: Main projectile animation at target position
 *
 * Original AS timing:
 * - Frame 1: Play sound "lance02", position at target
 * - Frame 7: Signal hit (this.end())
 * - Frame 36: Stop animation
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 1233.9,
  height: 895.2,
  offsetX: -619.2,
  offsetY: -526.2,
};

export class Spell2067 extends BaseSpell {
  readonly spellId = 2067;

  private shootAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Shoot animation at target position
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    
    // Position at target (AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y;)
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    
    // AS: _rotation = 0; (frame 1 of DefineSprite_10_shoot)
    this.shootAnim.sprite.rotation = 0;
    
    this.shootAnim
      .stopAt(35) // AS: frame 36, stop()
      .onFrame(0, () => this.callbacks.playSound('lance02')) // AS: frame 1, SOMA.playSound("lance02")
      .onFrame(6, () => this.signalHit()); // AS: frame 7, this.end()
    
    this.container.addChild(this.shootAnim.sprite);
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