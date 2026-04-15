/**
 * Spell 515 - Scierie (Sram)
 *
 * A single composite animation ("shoot") played at the caster position.
 *
 * Components:
 * - shoot (sprite): 150-frame composite animation at caster position
 *
 * Original AS timing:
 * - Frame 4 (DoAction.as): Play sound 'many_501', set position to cellFrom
 * - Frame 61 (DoAction.as): this.end() → signal hit
 * - Frame 109 (DoAction.as): Play sound 'many_502'
 * - Frame 148 (DoAction.as): _parent.removeMovieClip(); stop() → animation ends (0-indexed: 147)
 *
 * Note: The "pierres" particle sub-sprites and the DefineSprite_41 / DefineSprite_23
 * clips are embedded within the composite "shoot" frames, so their per-frame
 * physics is already baked into the exported SVG frames. We only need to drive
 * the top-level animation and fire the sound/hit callbacks at the correct frames.
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
  width: 119.9,
  height: 116.7,
  offsetX: -72.15,
  offsetY: -81.35,
};

export class Spell515 extends BaseSpell {
  readonly spellId = 515;

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

    // Frame 4 in AS (1-indexed) → frame index 3 (0-indexed): play sound
    this.shootAnim.onFrame(3, () => {
      this.callbacks.playSound("many_501");
    });

    // Frame 61 in AS (1-indexed) → frame index 60 (0-indexed): signal hit
    this.shootAnim.onFrame(60, () => {
      this.signalHit();
    });

    // Frame 109 in AS (1-indexed) → frame index 108 (0-indexed): play sound
    this.shootAnim.onFrame(108, () => {
      this.callbacks.playSound("many_502");
    });

    // Frame 148 in AS (1-indexed) → frame index 147 (0-indexed): stop
    this.shootAnim.stopAt(147);

    // Position at caster
    this.shootAnim.sprite.position.set(0, init.casterY);

    this.container.addChild(this.shootAnim.sprite);
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
