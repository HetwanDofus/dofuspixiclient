/**
 * Spell 111 - Artibuse (Roublard)
 *
 * A simple animation effect at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, stops at frame 66
 *
 * Original AS timing:
 * - DefineSprite_3/frame_1: gotoAndPlay(random(60) + 2) - random start frame
 * - DefineSprite_13/frame_1: SOMA.playSound("arty_111")
 * - DefineSprite_13/frame_10: SOMA.playSound("arty_111")
 * - DefineSprite_13/frame_19: SOMA.playSound("arty_111")
 * - DefineSprite_13/frame_31: SOMA.playSound("arty_111")
 * - DefineSprite_14/frame_67: _parent.removeMovieClip(); stop()
 *
 * The manifest sounds array confirms sound triggers at frames 0, 9, 18, 30 (0-indexed).
 * The animation stops at frame 66 (0-indexed) per manifest stopFrame.
 * Frame 66 (0-indexed) = frame 67 (1-indexed) triggers removeMovieClip -> complete.
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
  width: 158,
  height: 168.15,
  offsetX: -82.55,
  offsetY: -162.05,
};

export class Spell111 extends BaseSpell {
  readonly spellId = 111;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anim1Textures = textures.getFrames("anim1");
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // AS: DefineSprite_3/frame_1: gotoAndPlay(random(60) + 2)
    // random(60) returns 0..59, +2 gives 2..61 (1-indexed) = 1..60 (0-indexed)
    const startFrame = Math.floor(Math.random() * 60) + 1;

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

    // Sounds from DefineSprite_13 sub-sprite, triggered at frames 1, 10, 19, 31 (1-indexed)
    // = 0, 9, 18, 30 (0-indexed)
    // These are relative to the sub-sprite's own timeline. Since the composite animation
    // bakes them in, we use the manifest sounds array frames directly (0-indexed).
    // However, the startFrame offset means the sounds may be skipped if already past.
    // We register them relative to absolute frame positions as baked in the composite.
    anim.onFrame(0, () => this.callbacks.playSound("arty_111"));
    anim.onFrame(9, () => this.callbacks.playSound("arty_111"));
    anim.onFrame(18, () => this.callbacks.playSound("arty_111"));
    anim.onFrame(30, () => this.callbacks.playSound("arty_111"));

    // Signal hit when animation completes (frame 67 in AS = frame 66 0-indexed = stopFrame)
    // DefineSprite_14/frame_67: removeMovieClip -> complete
    anim.stopAt(66);
    anim.onFrame(66, () => this.signalHit());

    anim.addTo(this.container);
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
