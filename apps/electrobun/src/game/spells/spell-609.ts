/**
 * Spell 609 - (Iop/unknown)
 *
 * A single animated sprite at the target position that plays through 150 frames.
 * Two sub-sprites within the animation flicker randomly (alpha and rotation per frame).
 * The animation ends at frame 148 (AS frame_148 calls removeMovieClip).
 *
 * Components:
 * - anim1: 150-frame composite animation at target position
 *   - Internal sprites (DefineSprite_7 and a second sprite at frame 76):
 *     each frame: _alpha = random(20) + 80; _rotation = random(360)
 *   Since these are baked into the composite SVG frames, no extra logic is needed.
 *
 * Original AS timing:
 * - Frame 148 (0-indexed: 147): removeMovieClip() -> animation ends
 * - Hit signal: at frame 0 (instant hit on start, as there is no explicit end() call,
 *   we signal hit at frame 147 when the animation removes itself)
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
  width: 67.15,
  height: 144.5,
  offsetX: -28.95,
  offsetY: -134.35,
};

export class Spell609 extends BaseSpell {
  readonly spellId = 609;

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
        fps: 40,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // AS frame_148 (0-indexed: 147) calls removeMovieClip -> spell ends
    // Signal hit at that same frame
    this.mainAnim.stopAt(147).onFrame(147, () => {
      this.signalHit();
    });

    this.mainAnim.addTo(this.container);
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
