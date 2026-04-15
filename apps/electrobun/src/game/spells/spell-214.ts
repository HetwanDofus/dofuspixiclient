/**
 * Spell 214 - Crockette (Xelor)
 *
 * A single animation that plays at the target position with a looping sub-sprite.
 *
 * Components:
 * - anim1: Main composite animation at target position, 147 frames
 *
 * Original AS timing:
 * - DefineSprite_17 frame 1: Play sound 'crockette_214'
 * - DefineSprite_11 frame 1: gotoAndPlay(random(18) + 2) — random start frame
 * - DefineSprite_11 frame 4: _rotation = random(360)
 * - DefineSprite_11 frame 28: gotoAndPlay(2) — loop back
 * - DefineSprite_18 frame 145: removeMovieClip() — end of outer animation
 * - DefineSprite_3 enterFrame: _alpha = random(100) + 80; _rotation += 10
 *
 * The main anim1 is a composite of all these — the composite frames are
 * pre-rendered. We play anim1 frames 0–146 (147 frames total) at target,
 * signal hit at frame 0, and complete when done.
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
  width: 87.25,
  height: 29.9,
  offsetX: -17.65,
  offsetY: -78.6,
};

export class Spell214 extends BaseSpell {
  readonly spellId = 214;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anim1 = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        ...calculateAnchor(ANIM1_MANIFEST),
        scale: init.scale,
      })
    );

    anim1.sprite.position.set(init.targetX, init.targetY);

    anim1.onFrame(0, () => {
      this.callbacks.playSound("crockette_214");
      this.signalHit();
    });

    anim1.addTo(this.container);
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
