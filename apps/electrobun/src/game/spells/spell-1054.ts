/**
 * Spell 1054 - Sacrieur spell
 *
 * A composite animation (anim1) played at the target position.
 * The animation has 306 frames with sounds at frames 19, 106, and 196 (AS 1-indexed).
 * The animation ends at frame 304 (AS 1-indexed) via removeMovieClip().
 *
 * Components:
 * - anim1: Main composite animation at target position, 306 frames
 *
 * Original AS timing:
 * - Frame 19 (0-indexed: 18): Play sound 'sacrieur_1054'
 * - Frame 106 (0-indexed: 105): Play sound 'sacrieur_1054'
 * - Frame 196 (0-indexed: 195): Play sound 'sacrieur_1054'
 * - Frame 304 (0-indexed: 303): removeMovieClip() - animation ends
 *
 * Note: The sub-sprites (DefineSprite_16–21) have procedural per-frame behaviors
 * (random alpha flicker, sinusoidal scale, spiral motion, bounce physics) that are
 * baked into the composite SVG frames extracted from the SWF. The hit signal is
 * sent at the first sound trigger (frame 18, 0-indexed).
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
  width: 58.95,
  height: 46.3,
  offsetX: -22.6,
  offsetY: -30.3,
};

export class Spell1054 extends BaseSpell {
  readonly spellId = 1054;

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
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 19 (AS 1-indexed) -> frame 18 (0-indexed): play sound
    this.mainAnim.onFrame(18, () => {
      this.callbacks.playSound("sacrieur_1054");
      this.signalHit();
    });

    // Frame 106 (AS 1-indexed) -> frame 105 (0-indexed): play sound
    this.mainAnim.onFrame(105, () => {
      this.callbacks.playSound("sacrieur_1054");
    });

    // Frame 196 (AS 1-indexed) -> frame 195 (0-indexed): play sound
    this.mainAnim.onFrame(195, () => {
      this.callbacks.playSound("sacrieur_1054");
    });

    // Frame 304 (AS 1-indexed) -> frame 303 (0-indexed): removeMovieClip -> complete
    this.mainAnim.onFrame(303, () => {
      this.complete();
    });

    this.mainAnim.addTo(this.container);
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
