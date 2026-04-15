/**
 * Spell 612 - Dodge (Sram)
 *
 * A dodge/duplication spell with a shoot animation at the caster position
 * and a duplicate animation at the target position.
 *
 * Components:
 * - shoot (sprite): At caster position, plays through 84 frames, removes at frame 70
 * - duplicate (sprite): At target position, scaled by level, random start frame
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'dodge_604'
 * - Frame 1 (shoot): _rotation = 0
 * - Frame 70 (shoot): removeMovieClip() + stop() -> animation ends
 * - Frame 1 (duplicate): scale = 10 * level + 40; gotoAndStop(random(_totalframes) + 1)
 * - Frame 79 (DefineSprite_36): stop()
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 121.1,
  height: 112.65,
  offsetX: -58.55,
  offsetY: -74.2,
};

const DUPLICATE_MANIFEST: SpriteManifest = {
  width: 83.25,
  height: 133,
  offsetX: -50.05,
  offsetY: -83.7,
};

export class Spell612 extends BaseSpell {
  readonly spellId = 612;

  private shootAnim!: FrameAnimatedSprite;
  private duplicateAnim!: FrameAnimatedSprite;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Shoot animation at caster position
    // AS: frame_1 sets _rotation = 0; frame_70 calls removeMovieClip() + stop()
    const shootTextures = textures.getFrames("shoot");
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        fps: 60,
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = 0;

    // Frame 1 (main timeline): play sound (0-indexed = frame 0)
    this.shootAnim.onFrame(0, () => this.callbacks.playSound("dodge_604"));

    // Frame 70 (0-indexed = 69): removeMovieClip + stop -> complete shoot anim
    this.shootAnim.stopAt(69);

    this.container.addChild(this.shootAnim.sprite);

    // Duplicate animation at target position
    // AS: t = 10 * _parent.level + 40; _xscale = t; _yscale = t;
    // AS: gotoAndStop(random(_totalframes) + 1) -> random frame 0-indexed: random(3) = 0..2
    const duplicateTextures = textures.getFrames("duplicate");
    const duplicateAnchor = calculateAnchor(DUPLICATE_MANIFEST);

    // AS scale: t = 10 * level + 40 (as percentage), convert to 0-1
    const asScale = (10 * level + 40) / 100;
    const finalScale = init.scale * asScale;

    // AS: gotoAndStop(random(_totalframes) + 1) -> picks frame 1.._totalframes
    // _totalframes = 3, so random(3) + 1 = 1..3 -> 0-indexed: 0..2
    const startFrame = Math.floor(Math.random() * duplicateTextures.length);

    this.duplicateAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: duplicateTextures,
        fps: 60,
        anchorX: duplicateAnchor.x,
        anchorY: duplicateAnchor.y,
        scale: finalScale,
        startFrame,
      })
    );
    this.duplicateAnim.sprite.position.set(init.targetX, init.targetY);

    // The duplicate stops (gotoAndStop means it starts stopped at that frame)
    // Signal hit when the duplicate appears (frame 0 of duplicate)
    this.duplicateAnim.stopAt(startFrame);
    this.duplicateAnim.onFrame(startFrame, () => this.signalHit());

    this.container.addChild(this.duplicateAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when shoot animation reaches frame 70 (stopAt 69)
    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      this.complete();
    }
  }
}
