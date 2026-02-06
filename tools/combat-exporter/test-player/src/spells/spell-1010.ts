/**
 * Spell 1010 - Ronce Agressives
 *
 * A plant growth spell that spawns vines at caster position and an impact effect at target.
 *
 * Components:
 * - sprite_14: Vine/plant animation at caster, starts at random frame (1-30)
 * - sprite_15: Impact effect at target position
 *
 * Original AS timing:
 * - Frame 1: sprite_14 plays "herbe" sound and jumps to random frame 1-30
 * - Frame 151: sprite_14 plays "fronde" sound
 * - Frame 163: sprite_15 signals hit (this.end())
 * - Frame 202: sprite_15 removes itself
 * - Frame 259: sprite_14 stops
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const VINE_MANIFEST: SpriteManifest = {
  width: 428.70000000000005,
  height: 647.0999999999999,
  offsetX: -221.39999999999998,
  offsetY: -469.79999999999995,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 545.0999999999999,
  height: 852,
  offsetX: -264.6,
  offsetY: -573.9000000000001,
};

export class Spell1010 extends BaseSpell {
  readonly spellId = 1010;

  private vineAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const vineAnchor = calculateAnchor(VINE_MANIFEST);
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);

    // Random starting frame (AS: random(30) + 1, TS: 0-indexed)
    const randomStart = Math.floor(Math.random() * 30);

    // Vine animation at caster position
    this.vineAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_14'),
      anchorX: vineAnchor.x,
      anchorY: vineAnchor.y,
      scale: init.scale,
      startFrame: randomStart,
    }));
    this.vineAnim.sprite.position.set(0, init.casterY);
    this.vineAnim
      .stopAt(258)
      .onFrame(0, () => this.callbacks.playSound('herbe'))
      .onFrame(150, () => this.callbacks.playSound('fronde'));

    this.container.addChild(this.vineAnim.sprite);

    // Impact animation at target position
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_15'),
      anchorX: impactAnchor.x,
      anchorY: impactAnchor.y,
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim
      .onFrame(162, () => this.signalHit());
    
    this.container.addChild(this.impactAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Check if both animations are complete
    if (this.vineAnim.isStopped() && this.impactAnim.isComplete()) {
      this.complete();
    }
  }
}