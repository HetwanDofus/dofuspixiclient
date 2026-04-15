/**
 * Spell 610 - Dodge
 *
 * A single animation played at the target position.
 *
 * Components:
 * - anim1 (DefineSprite_20): Main animation at target position, 96 frames
 *   - Contains a child sprite (DefineSprite_9) that starts at a random frame (1-30)
 *     and stops at frame 40
 *   - Frame 7: Play sound 'dodge_610'
 *   - Frame 94: removeMovieClip() -> animation ends
 *
 * Original AS timing:
 * - DefineSprite_9/frame_1: gotoAndPlay(random(30) + 1) -> start at random frame 1-30
 * - DefineSprite_9/frame_40: stop()
 * - DefineSprite_20/frame_7: SOMA.playSound("dodge_610")
 * - DefineSprite_20/frame_94: _parent.removeMovieClip() -> complete
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
  width: 70.5,
  height: 360.9,
  offsetX: -35.55,
  offsetY: -340.7,
};

export class Spell610 extends BaseSpell {
  readonly spellId = 610;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // The main animation (DefineSprite_20) has 96 frames (indices 0-95)
    // The child sprite (DefineSprite_9) starts at random(30)+1 (1-indexed) = random frame 0-29 (0-indexed)
    // and stops at frame 40 (1-indexed) = frame 39 (0-indexed).
    // Since anim1 is a composite/flattened export, we use the startFrame to simulate
    // the random start of the inner sprite. The composite frames already incorporate
    // the inner sprite behavior, so we start the outer animation at a random offset
    // corresponding to random(30)+1 -> 0-indexed: Math.floor(Math.random() * 30)
    const randomStart = Math.floor(Math.random() * 30);

    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        startFrame: randomStart,
      })
    );

    mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 7 (1-indexed) = frame 6 (0-indexed): play sound
    mainAnim.onFrame(6, () => this.callbacks.playSound("dodge_610"));

    // Frame 94 (1-indexed) = frame 93 (0-indexed): removeMovieClip -> signal hit and complete
    mainAnim.onFrame(93, () => {
      this.signalHit();
    });

    this.container.addChild(mainAnim.sprite);
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
