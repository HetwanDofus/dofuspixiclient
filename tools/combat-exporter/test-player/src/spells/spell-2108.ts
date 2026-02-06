/**
 * Spell 2108 - Unknown Name
 *
 * A spell animation with a single composite sprite that has randomized internal elements.
 *
 * Components:
 * - anim1: Main composite animation at caster position
 *
 * Original AS timing:
 * - Frame 1: Play sound "grina_701"
 * - Frame 103: Animation completes
 * - Various internal sprites have randomized start frames and rotations
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 861,
  height: 408.6,
  offsetX: -386.1,
  offsetY: -204.3,
};

export class Spell2108 extends BaseSpell {
  readonly spellId = 2108;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anim1Frames = textures.getFrames('anim1');

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      frames: anim1Frames,
      frameRate: 60,
      loop: false,
      autoStart: true,
    }));

    this.mainAnim.scale.set(init.scale);
    this.mainAnim.anchor.copyFrom(calculateAnchor(ANIM1_MANIFEST));
    this.mainAnim.position.set(0, init.casterY);

    this.container.addChild(this.mainAnim);

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound('grina_701'))
      .stopAt(104);
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