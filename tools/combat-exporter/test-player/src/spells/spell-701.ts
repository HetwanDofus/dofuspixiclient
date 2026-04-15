/**
 * Spell 701 - Grina
 *
 * A single composite animation played at the target position.
 * The inner sprite (DefineSprite_10) picks a random start frame (1-6).
 * The outer sprite (DefineSprite_14) plays sound at frame 1, then
 * removes itself at frame 103 (0-indexed: 102).
 *
 * Components:
 * - anim1 (DefineSprite_14): 105-frame composite at target position
 *   - Inner (DefineSprite_10): random start frame 0-5 (AS: random(6)+1)
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_14): SOMA.playSound("grina_701")
 * - Frame 103 (DefineSprite_14): _parent.removeMovieClip() → complete
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 126,
  height: 76.55,
  offsetX: -25.95,
  offsetY: -13.6,
};

export class Spell701 extends BaseSpell {
  readonly spellId = 701;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // DefineSprite_10 picks a random start frame: gotoAndStop(random(6) + 1)
    // AS random(6) = 0..5, +1 = 1..6 (1-indexed) → 0-indexed: 0..5
    const startFrame = Math.floor(Math.random() * 6);

    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      startFrame,
    }));

    // Frame 1 (0-indexed: 0): play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('grina_701'));

    // Frame 103 (0-indexed: 102): removeMovieClip → complete
    this.mainAnim.onFrame(102, () => {
      this.signalHit();
      this.complete();
    });

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.signalHit();
      this.complete();
    }
  }
}
