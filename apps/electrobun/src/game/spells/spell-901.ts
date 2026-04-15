/**
 * Spell 901 - Flèche Punitive (Cra)
 *
 * A projectile spell with a "shoot" animation that wobbles on load then flies to target.
 *
 * Components:
 * - shoot (DefineSprite_9_shoot): The main projectile animation at caster position,
 *   rotated toward target. Contains two nested wobble behaviors:
 *   - DefineSprite_10_move: a=30, wobble amplitude 30, decays by /1.1 each frame
 *   - DefineSprite_8: a=15, wobble amplitude 15, decays by /1.1 each frame, stops at frame 64
 *
 * The "shoot" animation is a composite sprite (93 frames) that handles
 * the full projectile travel and impact. The nested wobble sprites are
 * baked into the composite frames.
 *
 * Original AS timing:
 * - DefineSprite_8/frame_64: stop()
 * - DefineSprite_9_shoot/frame_91: _parent.removeMovieClip() → animation ends
 *
 * Since the wobble behavior is baked into the extracted composite frames,
 * we simply play the "shoot" animation at caster position rotated toward target.
 * Hit is signaled at frame 90 (0-indexed) which corresponds to AS frame 91
 * where removeMovieClip() is called (just before stop).
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
  width: 29.75,
  height: 31.6,
  offsetX: -23.25,
  offsetY: -17.6,
};

export class Spell901 extends BaseSpell {
  readonly spellId = 901;

  private shootAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // AS frame 91 (0-indexed: 90) → removeMovieClip + stop → signal hit and complete
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
