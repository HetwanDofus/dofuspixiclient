/**
 * Spell 2917
 *
 * A composite animation with a single anim1 sprite positioned at the target.
 *
 * Components:
 * - anim1: Main animation at target position, stops at frame 237
 *
 * Original AS timing:
 * - Frame 238 (DefineSprite_47): stop() - animation stops at frame 237 (0-indexed)
 * - Frame 94 (DefineSprite_46): stop() - sub-sprite stops at frame 93 (0-indexed)
 * - Frame 97 (DefineSprite_7): stop() - sub-sprite stops at frame 96 (0-indexed)
 * - Frame 181 (DefineSprite_19): removeMovieClip() / stop() - signals completion
 * - Frame 40 (DefineSprite_44): stop() - sub-sprite stops at frame 39 (0-indexed)
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
  width: 83.85,
  height: 216.65,
  offsetX: -51.05,
  offsetY: -145.3,
};

export class Spell2917 extends BaseSpell {
  readonly spellId = 2917;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anim1Textures = textures.getFrames("anim1");
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    // DefineSprite_47 frame_238 -> stop() at 0-indexed frame 237
    anim.stopAt(237);

    // DefineSprite_19 frame_181 -> removeMovieClip() at 0-indexed frame 180
    anim.onFrame(180, () => this.signalHit());

    this.container.addChild(anim.sprite);
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
