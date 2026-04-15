/**
 * Spell 301 - Setag
 *
 * A composite animation spell with a spiraling particle effect.
 *
 * Components:
 * - anim1: Main composite animation at target position, 327 frames, stops at frame 324
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'setag_301'
 * - Frame 88 (DefineSprite_25): Signal hit (this.end())
 * - Frame 325 (DefineSprite_25): removeMovieClip / stop
 *
 * The composite animation (anim1) is a pre-rendered composite that includes:
 * - DefineSprite_23: Pulsing/scaling sprite with random rotation, alpha, and xscale animation
 * - DefineSprite_24: Spiraling particle with sinusoidal XY motion and fade
 * - DefineSprite_3: Bouncing particle with gravity
 * - DefineSprite_21: Speed-accelerating looping sprite
 * - DefineSprite_25: Main container (frame 88 = hit, frame 325 = end)
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
  width: 43.65,
  height: 35.15,
  offsetX: -22.6,
  offsetY: -13.1,
};

export class Spell301 extends BaseSpell {
  readonly spellId = 301;

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

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound("setag_301"))
      .onFrame(87, () => this.signalHit())
      .stopAt(324);

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
