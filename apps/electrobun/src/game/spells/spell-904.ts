/**
 * Spell 904 - Fulminant (Iop)
 *
 * A composite spell animation with a single animated sprite at the target position.
 *
 * Components:
 * - anim1: Main composite animation at target position, 318 frames, stops at frame 315
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'jet_904'
 * - Frame 316 (DefineSprite_14): removeMovieClip / stop - animation ends
 *
 * The animation is a composite sprite that includes internally:
 * - Bouncing particles with gravity (DefineSprite_3)
 * - Flickering alpha sprites (DefineSprite_12)
 * - Wobbling/scaling sprites with sin wave (DefineSprite_10)
 * - Spiraling rising particles with fade (DefineSprite_13)
 * - Randomly scaled sprites (DefineSprite_9)
 * All internal behavior is baked into the composite frames.
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
  width: 54,
  height: 42.15,
  offsetX: -22.6,
  offsetY: -21.3,
};

export class Spell904 extends BaseSpell {
  readonly spellId = 904;

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
      .stopAt(315)
      .onFrame(0, () => this.callbacks.playSound("jet_904"))
      .onFrame(0, () => this.signalHit());

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
