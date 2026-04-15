/**
 * Spell 2112 - Dodge (Eniripsa)
 *
 * A single animation (anim1) played at the target position.
 *
 * Components:
 * - anim1: 96-frame composite animation at target position
 *
 * Original AS timing:
 * - DefineSprite_17/frame_1: gotoAndPlay(random(15) + 1) → jump to random frame 0-14
 * - DefineSprite_17/frame_40: stop()
 * - DefineSprite_19/frame_7: SOMA.playSound("dodge_610")
 * - DefineSprite_19/frame_94: _parent.removeMovieClip() → animation ends
 *
 * The main timeline (DefineSprite_19) contains sprite_17 instances.
 * The anim1 export is the composite of DefineSprite_19.
 * Frame 7 → sound, frame 94 → complete (0-indexed: 6, 93).
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
  height: 278.8,
  offsetX: -35.55,
  offsetY: -258.6,
};

export class Spell2112 extends BaseSpell {
  readonly spellId = 2112;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Random start frame: AS gotoAndPlay(random(15) + 1) = frames 1..15 (1-indexed)
    // 0-indexed: 0..14
    const startFrame = Math.floor(Math.random() * 15);

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        startFrame,
      })
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    // Frame 7 (0-indexed: 6) → play sound
    anim.onFrame(6, () => this.callbacks.playSound("dodge_610"));

    // Frame 94 (0-indexed: 93) → removeMovieClip → complete
    anim.onFrame(93, () => this.signalHit());
    anim.stopAt(95);

    this.container.addChild(anim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete() || this.anims.allStopped()) {
      this.complete();
    }
  }
}
