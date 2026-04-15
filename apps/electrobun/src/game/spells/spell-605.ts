/**
 * Spell 605 - Dodge (Sram)
 *
 * A dodge animation with randomized alpha effects.
 *
 * Components:
 * - anim1: Main dodge animation at target position, 135 frames
 *
 * Original AS timing:
 * - DefineSprite_21/frame_1: enterFrame sets _alpha = 20 + random(70) each frame
 * - DefineSprite_29/frame_28: Play sounds 'dodge_605' and 'pas_homme_normal'
 * - DefineSprite_29/frame_37: enterFrame sets _alpha = 20 + random(70) each frame
 * - DefineSprite_29/frame_40: Play sound 'pas_homme_normal'
 * - DefineSprite_29/frame_133: removeMovieClip() - animation ends
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
  width: 59.5,
  height: 60.85,
  offsetX: -31.25,
  offsetY: -108.2,
};

export class Spell605 extends BaseSpell {
  readonly spellId = 605;

  private mainAnim!: FrameAnimatedSprite;
  private alphaRandomizerActive = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 28 (AS frame 28, 0-indexed: 27): play sounds
    this.mainAnim.onFrame(27, () => {
      this.callbacks.playSound("dodge_605");
      this.callbacks.playSound("pas_homme_normal");
    });

    // Frame 37 (AS frame 37, 0-indexed: 36): start second alpha randomizer phase
    this.mainAnim.onFrame(36, () => {
      this.alphaRandomizerStartFrame = 36;
      this.alphaRandomizerActive = true;
    });

    // Frame 40 (AS frame 40, 0-indexed: 39): play sound
    this.mainAnim.onFrame(39, () => {
      this.callbacks.playSound("pas_homme_normal");
    });

    // Frame 133 (AS frame 133, 0-indexed: 132): removeMovieClip - signal hit and end
    this.mainAnim.onFrame(132, () => {
      this.signalHit();
    });

    // The animation has 135 frames total, completion is at frame 134 (0-indexed)
    // DefineSprite_29/frame_133 calls removeMovieClip, so we stop at 132 (0-indexed)
    this.mainAnim.stopAt(132);

    this.container.addChild(this.mainAnim.sprite);

    // Alpha randomizer is active from frame 1 (DefineSprite_21 enterFrame)
    // The outer sprite (DefineSprite_21) has its alpha randomized every frame
    // This applies to the whole animation from the start
    this.alphaRandomizerActive = true;
    this.alphaRandomizerStartFrame = 0;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply alpha randomization every frame (replicates onClipEvent(enterFrame))
    // AS: _alpha = 20 + random(70) — random(70) returns 0..69
    if (this.alphaRandomizerActive) {
      this.mainAnim.sprite.alpha = (20 + Math.floor(Math.random() * 70)) / 100;
    }

    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      this.complete();
    }
  }
}
