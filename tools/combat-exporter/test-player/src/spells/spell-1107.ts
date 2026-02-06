/**
 * Spell 1107 - Autre
 *
 * A spell with a main animation and a secondary looping animation.
 *
 * Components:
 * - sprite_5: Main effect animation (210 frames)
 * - sprite_18: Secondary looping animation (39 frames with randomized start)
 *
 * Original AS timing:
 * - Frame 1: Play sound "autre_1107"
 * - Frame 205: Signal hit (this.end())
 * - Frame 238: Remove movie clip
 * - sprite_18: Starts at random frame 0-29, loops back from frame 36 to frame 5
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const MAIN_MANIFEST: SpriteManifest = {
  width: 754.2,
  height: 754.2,
  offsetX: -432.90000000000003,
  offsetY: -396.29999999999995,
};

const SECONDARY_MANIFEST: SpriteManifest = {
  width: 381.29999999999995,
  height: 263.4,
  offsetX: -171.3,
  offsetY: -153.60000000000002,
};

export class Spell1107 extends BaseSpell {
  readonly spellId = 1107;

  private mainAnim!: FrameAnimatedSprite;
  private secondaryAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation (sprite_5)
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_5'),
      ...calculateAnchor(MAIN_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('autre_1107'))
      .onFrame(204, () => this.signalHit());
    this.container.addChild(this.mainAnim.sprite);

    // Secondary animation (sprite_18) with randomized start
    const randomStart = Math.floor(Math.random() * 30);
    this.secondaryAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_18'),
      ...calculateAnchor(SECONDARY_MANIFEST),
      scale: init.scale,
      startFrame: randomStart,
    }));
    this.secondaryAnim.sprite.position.set(init.targetX, init.targetY);
    this.secondaryAnim.onFrame(36, () => {
      this.secondaryAnim.gotoAndPlay(5);
    });
    this.container.addChild(this.secondaryAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when main animation finishes
    if (this.mainAnim.isComplete()) {
      this.complete();
    }
  }
}