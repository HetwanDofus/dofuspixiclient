/**
 * Spell 2040
 *
 * A projectile spell with a wobbling rotation effect during flight,
 * followed by an impact animation.
 *
 * Components:
 * - shoot (sprite): Main animation at caster position, rotated toward target
 *   - Contains a "move" sub-object with oscillating rotation (a=30, decay=1.1)
 *   - Contains an outer wobble with oscillating rotation (a=10, decay=1.5)
 *
 * The "shoot" animation is a composite that encodes all motion.
 * The animation plays 93 frames total.
 *
 * Original AS timing:
 * - DefineSprite_10_move: oscillates _rotation = 90 + a * cos(i += 0.6), a /= 1.1 each frame
 * - DefineSprite_8: oscillates _rotation = 90 + a * cos(i += pi), a /= 1.5 each frame
 * - DefineSprite_8/frame_64: stop() -> stops at frame 63 (0-indexed)
 * - DefineSprite_9_shoot/frame_91: removeMovieClip() -> animation ends at frame 90 (0-indexed)
 *
 * Hit is signaled when the projectile reaches the target (frame 90, end of shoot anim).
 * Completion when the shoot animation finishes.
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 37.95,
  height: 31.6,
  offsetX: -31.45,
  offsetY: -17.6,
};

export class Spell2040 extends BaseSpell {
  readonly spellId = 2040;

  private shootAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const shootTextures = textures.getFrames("shoot");
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame 90 (0-indexed) = AS frame 91: removeMovieClip -> signal hit and end
    this.shootAnim.onFrame(90, () => {
      this.signalHit();
    });

    this.container.addChild(this.shootAnim.sprite);
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
