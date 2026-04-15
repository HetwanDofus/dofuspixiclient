/**
 * Spell 801 - Vlad
 *
 * A composite spell animation with a single 306-frame animation played at the target position.
 * The animation includes internal sub-sprites with various physics behaviors:
 * - DefineSprite_9: Random scale (80-129%) on load
 * - DefineSprite_10: Sinusoidal xscale oscillation with random rotation/alpha
 * - DefineSprite_3: Gravity bounce physics (Y falls, bounces at Y=0)
 * - DefineSprite_13: Spiral rise animation with alpha fade in/out
 * - DefineSprite_12: Random alpha flicker each frame
 *
 * Since all sub-sprite physics are baked into the composite anim1 frames,
 * we simply play the anim1 animation at the target position.
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'vlad_801'
 * - Frame 304 (DefineSprite_14): removeMovieClip() - signals end
 * - Frame 306: Animation completes naturally
 *
 * Hit signal: at frame 0 (instant spell, no projectile)
 * Complete: when anim1 finishes (frame 305, 0-indexed)
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
  width: 46.35,
  height: 29.35,
  offsetX: -22.6,
  offsetY: -16.1,
};

export class Spell801 extends BaseSpell {
  readonly spellId = 801;

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

    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound("vlad_801");
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
