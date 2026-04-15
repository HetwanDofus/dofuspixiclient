/**
 * Spell 614 - Dodge/Esquive (Iop)
 *
 * A single composite animation that plays at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, 102 frames
 *
 * Original AS timing:
 * - Frame 13 (DoAction): Play sound 'dodge_607b'
 * - Frame 22 (DoAction): Play sound 'dodge_614'
 * - Frame 100 (DoAction): removeMovieClip() - animation ends
 *
 * Note: DefineSprite_8 (frame 73 stop) and DefineSprite_9/DefineSprite_10
 * are sub-sprites within the composite anim1 frames. Their per-frame
 * randomization (_rotation, _alpha) is baked into the composite SVG frames.
 * The main timeline is DefineSprite_11 which drives the overall spell.
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
  width: 378.75,
  height: 473.15,
  offsetX: -188.85,
  offsetY: -343.05,
};

export class Spell614 extends BaseSpell {
  readonly spellId = 614;

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

    // Frame 13 (AS 1-indexed) -> frame 12 (0-indexed): play sound 'dodge_607b'
    anim1.onFrame(12, () => this.callbacks.playSound("dodge_607b"));

    // Frame 22 (AS 1-indexed) -> frame 21 (0-indexed): play sound 'dodge_614'
    anim1.onFrame(21, () => this.callbacks.playSound("dodge_614"));

    // Frame 22 is also when the hit lands (sound plays on impact)
    anim1.onFrame(21, () => this.signalHit());

    // Frame 100 (AS 1-indexed) -> frame 99 (0-indexed): removeMovieClip
    anim1.onFrame(99, () => this.complete());

    this.container.addChild(anim1.sprite);
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
