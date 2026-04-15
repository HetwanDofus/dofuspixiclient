/**
 * Spell 2909 - (Eniripsa / Fulminant variant)
 *
 * A single composite animation (anim1) that plays at the target position.
 * The animation contains nested sprites with sinusoidal rotation/movement
 * and a floating particle that drifts upward and fades out after frame 330.
 *
 * Components:
 * - anim1: Composite animation (390 frames) at target position
 *   - Contains a floating smoke/particle (DefineSprite_9) that drifts with wind
 *   - Contains a wobbling element (DefineSprite_8) with sinusoidal X movement
 *   - Contains nested rotation elements (DefineSprite_4, DefineSprite_5, DefineSprite_7)
 *     driven by a shared vamp oscillator
 *
 * Original AS timing:
 * - frame_13/DoAction.as: stop() — the main timeline stops at frame 13 (0-indexed: 12)
 * - DefineSprite_9/frame_388/DoAction.as: removeMovieClip() / stop() at frame 388 (0-indexed: 387)
 * - The manifest stopFrame is 387 (0-indexed), fadingFrame is 386 (0-indexed)
 *
 * Since the main timeline calls stop() at frame 13 (AS) = frame 12 (0-indexed),
 * the composite animation is essentially a looping/stopped single-frame display.
 * The anim1 composite handles all visual complexity internally via the SVG frames.
 *
 * Hit signal: sent at frame 0 (immediately, since this is an instant/aura effect
 * on the target — the AS has no explicit end() call, the animation just runs its
 * full course and stops at the manifest stopFrame).
 *
 * Completion: when anim1 reaches stopFrame (387).
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

export class Spell2909 extends BaseSpell {
  readonly spellId = 2909;

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
        stopFrame: 387,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Signal hit immediately — this is an on-target aura/DoT effect
    // No explicit end() in AS, hit is applied when animation begins
    this.mainAnim.onFrame(0, () => this.signalHit());

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
