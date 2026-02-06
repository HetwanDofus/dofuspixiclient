/**
 * Spell 1101 - Piqûre Motivante
 *
 * A spell with a cloud effect and a vertical spike animation that rises from below.
 *
 * Components:
 * - sprite_2: Main cloud animation playing full sequence
 * - sprite_4: Vertical spike animation that loops with random start
 *
 * Original AS timing:
 * - Frame 1: Play sound "autre_1101"
 * - Frame 137: Signal hit (this.end())
 * - Frame 159: Remove spell (this.removeMovieClip())
 * - sprite_4: Random start frame (0-59), loops back to frame 6 at frame 142
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const CLOUD_MANIFEST: SpriteManifest = {
  width: 898.8000000000001,
  height: 899.0999999999999,
  offsetX: -505.20000000000005,
  offsetY: -468.90000000000003,
};

const SPIKE_MANIFEST: SpriteManifest = {
  width: 762.3,
  height: 3040.2,
  offsetX: -653.7,
  offsetY: -2961,
};

export class Spell1101 extends BaseSpell {
  readonly spellId = 1101;

  private cloudAnim!: FrameAnimatedSprite;
  private spikeAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const cloudAnchor = calculateAnchor(CLOUD_MANIFEST);
    const spikeAnchor = calculateAnchor(SPIKE_MANIFEST);

    // Main cloud animation at target position
    this.cloudAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_2'),
      anchorX: cloudAnchor.x,
      anchorY: cloudAnchor.y,
      scale: init.scale,
    }));
    this.cloudAnim.sprite.position.set(init.targetX, init.targetY);
    this.cloudAnim
      .onFrame(0, () => this.callbacks.playSound('autre_1101'))
      .onFrame(136, () => this.signalHit());
    this.container.addChild(this.cloudAnim.sprite);

    // Vertical spike animation with random start
    this.spikeAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_4'),
      anchorX: spikeAnchor.x,
      anchorY: spikeAnchor.y,
      scale: init.scale,
      startFrame: Math.floor(Math.random() * 60),
    }));
    this.spikeAnim.sprite.position.set(init.targetX, init.targetY);
    this.spikeAnim.onFrame(141, () => this.spikeAnim.gotoFrame(5));
    this.container.addChild(this.spikeAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when cloud animation finishes at frame 159
    if (this.cloudAnim.getFrame() >= 158) {
      this.complete();
    }
  }
}