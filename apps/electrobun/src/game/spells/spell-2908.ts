/**
 * Spell 2908 - Vampire (Sacrieur)
 *
 * A composite animation with a single anim1 sprite that plays through 390 frames,
 * stopping at frame 387 (0-indexed). The animation contains internal sub-sprites
 * with sinusoidal rotation/oscillation behaviors baked into the composite frames.
 *
 * Components:
 * - anim1: Composite animation at target position, 390 frames, stops at frame 387
 *
 * Original AS timing:
 * - frame_13/DoAction.as: stop() — signals hit at frame 12 (0-indexed)
 * - DefineSprite_9/frame_388/DoAction.as: removeMovieClip() + stop() — animation ends at frame 387 (0-indexed)
 * - Internal sub-sprites have sinusoidal oscillation (baked into composite frames)
 * - Smoke particles (DefineSprite_9): rise upward with wind drift, fade after t > 330
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
  width: 13.3,
  height: 36.45,
  offsetX: -5.9,
  offsetY: -54.15,
};

export class Spell2908 extends BaseSpell {
  readonly spellId = 2908;

  private anim1!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Main composite animation at target position
    this.anim1 = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        stopFrame: 387,
      })
    );

    this.anim1.sprite.position.set(init.targetX, init.targetY);

    // frame_13/DoAction.as: stop() at frame 13 (1-indexed) = frame 12 (0-indexed)
    // This is the hit signal point
    this.anim1.onFrame(12, () => this.signalHit());

    this.container.addChild(this.anim1.sprite);
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
