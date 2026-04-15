/**
 * Spell 703 - Grina
 *
 * A composite animation spell with a single 135-frame animation played at the target position.
 * The animation fades in for the first portion, then fades out toward the end.
 *
 * Components:
 * - anim1 (135 frames): Main animation at target position with fade in/out
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_703'
 * - DefineSprite_10 frame 1: alpha starts at 0, increases by 2.5 per frame
 * - DefineSprite_10 frame 106: alpha starts decreasing by 3.33 per frame
 * - DefineSprite_10 frame 133: removeMovieClip() - animation ends
 *
 * Note: DefineSprite_8 (loops frames 2-127) and DefineSprite_7 (random scale 20-50%)
 * and DefineSprite_6 (gotoAndStop random 2-5) appear to be sub-components of the
 * composite anim1 sprite sheet, already baked into the frames.
 *
 * The alpha fade behavior is implemented manually:
 * - Frames 0-105: alpha += 2.5 per frame (capped at 100)
 * - Frames 106-132: alpha -= 3.33 per frame
 * - Frame 132 (0-indexed): removeMovieClip equivalent -> complete
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
  width: 231.6,
  height: 164.8,
  offsetX: -108.3,
  offsetY: -124.65,
};

export class Spell703 extends BaseSpell {
  readonly spellId = 703;

  private mainAnim!: FrameAnimatedSprite;
  private alphaValue = 0;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 40,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    // Start with alpha 0 (AS: _parent._alpha = 0)
    this.alphaValue = 0;
    this.mainAnim.sprite.alpha = 0;
    this.frameCount = 0;

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Play sound on frame 0 (AS frame 1)
    this.mainAnim.onFrame(0, () => this.callbacks.playSound("grina_703"));

    // Signal hit at approximately the midpoint of the animation (frame 52, ~midpoint before fade)
    this.mainAnim.onFrame(52, () => this.signalHit());

    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Track frame count for alpha management
    // AS: onClipEvent(enterFrame) fires each frame
    // Frame 1 (0-indexed: 0): alpha starts at 0, +2.5 each frame
    // Frame 106 (0-indexed: 105): alpha starts decreasing by 3.33 each frame
    // Frame 133 (0-indexed: 132): removeMovieClip

    const currentFrame = this.mainAnim.getFrame();

    if (currentFrame < 105) {
      // AS frames 1-105: alpha += 2.5 per frame
      this.alphaValue += 2.5;
    } else if (currentFrame >= 105) {
      // AS frame 106+: alpha -= 3.33 per frame
      this.alphaValue -= 3.33;
    }

    // Clamp alpha to 0-100 range (AS _alpha is 0-100, PixiJS alpha is 0-1)
    if (this.alphaValue > 100) {
      this.alphaValue = 100;
    }
    if (this.alphaValue < 0) {
      this.alphaValue = 0;
    }

    this.mainAnim.sprite.alpha = this.alphaValue / 100;

    // AS frame 133 (0-indexed: 132): _parent.removeMovieClip()
    if (currentFrame >= 132 || this.mainAnim.isComplete()) {
      this.complete();
    }
  }
}
