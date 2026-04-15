/**
 * Spell 811 - Licrounch (Crâ)
 *
 * A single animation played at the target position.
 * The inner sprite (DefineSprite_6) starts at a random frame (random(45) + 2),
 * which is baked into the composite anim1 frames.
 * Since the animation is composite and exported as anim1, we use it directly
 * with a random start frame.
 *
 * Components:
 * - anim1 (114 frames): Main animation at target position
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_17): Play sound 'licrounch_1008'
 * - Frame 1 (DefineSprite_6): gotoAndPlay(random(45) + 2) — random start within inner clip
 * - Frame 112 (DefineSprite_17): removeMovieClip() — animation ends
 *
 * Note: The hit signal is delivered at the end of the animation (frame 111, 0-indexed),
 * matching the removeMovieClip() at AS frame 112.
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
  width: 117,
  height: 191.25,
  offsetX: -58.5,
  offsetY: -162.05,
};

export class Spell811 extends BaseSpell {
  readonly spellId = 811;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anim1Textures = textures.getFrames("anim1");
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // AS DefineSprite_6/frame_1: gotoAndPlay(random(45) + 2)
    // random(45) = 0..44, so result is 2..46 (1-indexed) = 1..45 (0-indexed)
    const startFrame = Math.floor(Math.random() * 45) + 1;

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        startFrame,
      })
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    // AS DefineSprite_17/frame_1: SOMA.playSound("licrounch_1008")
    // Frame 1 (1-indexed) = frame 0 (0-indexed)
    anim.onFrame(0, () => this.callbacks.playSound("licrounch_1008"));

    // AS DefineSprite_17/frame_112: _parent.removeMovieClip()
    // Frame 112 (1-indexed) = frame 111 (0-indexed)
    anim.onFrame(111, () => {
      this.signalHit();
    });

    anim.addTo(this.container);
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
