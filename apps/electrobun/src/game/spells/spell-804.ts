/**
 * Spell 804 - Vlad (Sadida)
 *
 * A single composite animation played at the target position.
 * Contains inner clip behaviors:
 * - DefineSprite_10: A sub-sprite that randomizes alpha every frame, stops at frame 64
 * - DefineSprite_11: Particles spawned at frame 4 with physics (r, v, xscale/yscale, alpha decay)
 * - DefineSprite_13: Main animation, plays sound at frame 4, sets ta, ends at frame 190
 *
 * Components:
 * - anim1: Main composite animation at target position, 192 frames
 *
 * Original AS timing:
 * - Frame 4 (DefineSprite_13): Play sound 'vlad_804', set ta = 5 + 20 * level
 * - Frame 190 (DefineSprite_13): removeMovieClip() - animation ends
 *
 * The composite animation (anim1) bakes all inner clip behavior into its frames,
 * so we only need to play it, trigger the sound at frame 3 (0-indexed), signal hit
 * at the same time, and complete when the animation finishes.
 *
 * Hit signal: frame 3 (AS frame 4 - the impact frame where sound plays)
 * Complete: when anim1 finishes (frame 191, 0-indexed, = AS frame 192)
 * But DefineSprite_13 frame 190 (0-indexed: 189) calls removeMovieClip,
 * so we complete at frame 189.
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
  width: 137.8,
  height: 136.15,
  offsetX: -29.55,
  offsetY: -86.3,
};

export class Spell804 extends BaseSpell {
  readonly spellId = 804;

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

    // AS DefineSprite_13 frame_4 (0-indexed: 3): play sound and signal hit
    this.mainAnim.onFrame(3, () => {
      this.callbacks.playSound("vlad_804");
      this.signalHit();
    });

    // AS DefineSprite_13 frame_190 (0-indexed: 189): removeMovieClip
    this.mainAnim.onFrame(189, () => {
      this.complete();
    });

    this.mainAnim.addTo(this.container);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.mainAnim.isComplete()) {
      this.complete();
    }
  }
}
