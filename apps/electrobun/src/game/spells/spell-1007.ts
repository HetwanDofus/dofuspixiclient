/**
 * Spell 1007 - Herbe (Eniripsa)
 *
 * A composite animation with multiple layers:
 * - DefineSprite_14: Main timeline (297 frames), plays sound at frames 1, 58, 121, 184,
 *   signals hit at frame 178, removes self at frame 295
 * - DefineSprite_12: Background leaf sprites, random start frame (1-40), random alpha (30-79%),
 *   random scale (t=30-149, xscale=t, yscale=t/2), stops at frame 289
 * - DefineSprite_8: Foreground leaf sprites, 80% chance to skip to frame 20, stops at frame 55
 *
 * The manifest provides a single composite animation (anim1, 297 frames).
 * We use it directly as the main animation, with sound/hit/completion callbacks
 * mapped from the AS timing.
 *
 * Original AS timing (1-indexed → 0-indexed):
 * - Frame 1  (idx 0):   Play sound 'herbe'
 * - Frame 58 (idx 57):  Play sound 'herbe'
 * - Frame 121 (idx 120): Play sound 'herbe'
 * - Frame 178 (idx 177): Signal hit (this.end())
 * - Frame 184 (idx 183): Play sound 'herbe'
 * - Frame 295 (idx 294): removeMovieClip / animation ends (stopFrame in manifest)
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
  width: 95.1,
  height: 38.1,
  offsetX: -49.25,
  offsetY: -17.05,
};

export class Spell1007 extends BaseSpell {
  readonly spellId = 1007;

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
        stopFrame: 294,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound("herbe"))
      .onFrame(57, () => this.callbacks.playSound("herbe"))
      .onFrame(120, () => this.callbacks.playSound("herbe"))
      .onFrame(177, () => this.signalHit())
      .onFrame(183, () => this.callbacks.playSound("herbe"));

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
