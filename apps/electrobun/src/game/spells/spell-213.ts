/**
 * Spell 213 - Crockette (Xelor)
 *
 * A composite animation spell with 306 frames played at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, 306 frames
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'crockette_213'
 * - Frame 304 (DefineSprite_13): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const ANIM1_MANIFEST: SpriteManifest = {
  width: 48,
  height: 46.1,
  offsetX: -22.6,
  offsetY: -18.55,
};

export class Spell213 extends BaseSpell {
  readonly spellId = 213;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound("crockette_213"));

    // Signal hit at the start of the impact animation
    this.mainAnim.onFrame(0, () => this.signalHit());

    // Frame 304 (0-indexed: 303): removeMovieClip - animation ends
    this.mainAnim.stopAt(303);

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
