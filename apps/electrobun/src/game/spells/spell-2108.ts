/**
 * Spell 2108 - Grina
 *
 * A composite animation spell with a single anim1 animation.
 *
 * Components:
 * - anim1: Main animation at target position, 105 frames
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_701'
 * - Frame 103 (DefineSprite_23): removeMovieClip() - animation ends
 * - DefineSprite_13 loops at frame 52 back to frame 2
 * - DefineSprite_21 instances start at random rotation
 * - DefineSprite_22 instances start at random frames
 * - DefineSprite_15 rotates +1.6 degrees per frame
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
  width: 143.5,
  height: 68.1,
  offsetX: -64.35,
  offsetY: -34.05,
};

export class Spell2108 extends BaseSpell {
  readonly spellId = 2108;

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
    this.mainAnim.onFrame(0, () => this.callbacks.playSound("grina_701"));

    // Frame 103 (0-indexed: 102): DefineSprite_23 calls removeMovieClip -> signal hit and complete
    this.mainAnim.onFrame(102, () => {
      this.signalHit();
    });

    this.container.addChild(this.mainAnim.sprite);
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
