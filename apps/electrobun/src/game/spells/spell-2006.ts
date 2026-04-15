/**
 * Spell 2006 - Grina/Wab
 *
 * A spell with a main impact animation (sprite_26) at the target position,
 * plus a looping background animation (sprite_16) with randomized start frames,
 * and sprite_23 instances with randomized start frames used as decorative elements.
 *
 * Components:
 * - sprite_26: Main impact animation at target position (183 frames)
 *   - Frame 1: Play sound 'grina_709', position at cellTo
 *   - Frame 25: Play sound 'wab_2006'
 *   - Frame 34: Signal hit (this.end())
 *   - Frame 97: Remove (animation ends)
 * - sprite_16: Looping background with random start (54 frames, loops at frame 52 back to 2)
 * - sprite_23: Three instances with random start frames (via DefineSprite_24)
 * - sprite_18: Rotation animation (+1.67 deg/frame)
 *
 * Original AS timing:
 * - Frame 1 (sprite_26): Play 'grina_709', set position to cellTo
 * - Frame 25 (sprite_26): Play 'wab_2006'
 * - Frame 34 (sprite_26): this.end() → signal hit
 * - Frame 97 (sprite_26): removeMovieClip() → complete
 * - Frame 1 (sprite_16): gotoAndPlay(random(30) + 2) → start at random frame 2-31 (0-indexed: 1-30)
 * - Frame 52 (sprite_16): gotoAndPlay(2) → loop back to frame 2 (0-indexed: 1)
 * - DefineSprite_24 instances: gotoAndPlay(random(_totalframes + 1)) → random start
 * - sprite_23 rotation: -random(180) → random negative rotation
 * - sprite_18 enterFrame: _rotation += 1.67 per frame
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_26_MANIFEST: SpriteManifest = {
  width: 162,
  height: 355.3,
  offsetX: -80.95,
  offsetY: -306.55,
};

const SPRITE_16_MANIFEST: SpriteManifest = {
  width: 34.5,
  height: 13.4,
  offsetX: -0.7,
  offsetY: -13.4,
};

const SPRITE_23_MANIFEST: SpriteManifest = {
  width: 56.65,
  height: 2.8,
  offsetX: 18,
  offsetY: -2.75,
};

export class Spell2006 extends BaseSpell {
  readonly spellId = 2006;

  private impactAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // sprite_16: looping background animation at target position
    // AS: gotoAndPlay(random(30) + 2) → 0-indexed start: random(30) gives 0..29, +2 AS = 0-indexed 1..30
    const sprite16Textures = textures.getFrames("sprite_16");
    const sprite16Anchor = calculateAnchor(SPRITE_16_MANIFEST);
    const sprite16StartFrame = Math.floor(Math.random() * 30) + 1;

    const bgAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: sprite16Textures,
        anchorX: sprite16Anchor.x,
        anchorY: sprite16Anchor.y,
        scale: init.scale,
        startFrame: sprite16StartFrame,
        loop: false,
      })
    );
    bgAnim.sprite.position.set(init.targetX, init.targetY);
    // AS frame 52 (0-indexed: 51): gotoAndPlay(2) → loop back to frame index 1
    bgAnim.onFrame(51, () => {
      bgAnim.gotoFrame(1);
    });
    this.container.addChild(bgAnim.sprite);

    // Three sprite_23 instances (DefineSprite_24 with 3 PlaceObject2_23 entries)
    // Each: gotoAndPlay(random(_totalframes + 1)) → random start 0..(totalFrames)
    // sprite_23 has 15 frames, so random(16) → 0..15, clamped to 0..14
    // sprite_23 frame_1/DoAction.as: _rotation = -random(180) → random rotation 0..-179
    const sprite23Textures = textures.getFrames("sprite_23");
    const sprite23Anchor = calculateAnchor(SPRITE_23_MANIFEST);
    const totalFrames23 = sprite23Textures.length; // 15

    for (let i = 0; i < 3; i++) {
      const startFrame23 = Math.floor(Math.random() * (totalFrames23 + 1));
      const clampedStart = Math.min(startFrame23, totalFrames23 - 1);
      const rotation23 = -Math.floor(Math.random() * 180);

      const sprite23 = this.anims.add(
        new FrameAnimatedSprite({
          textures: sprite23Textures,
          anchorX: sprite23Anchor.x,
          anchorY: sprite23Anchor.y,
          scale: init.scale,
          startFrame: clampedStart,
          loop: true,
        })
      );
      sprite23.sprite.position.set(init.targetX, init.targetY);
      sprite23.sprite.rotation = (rotation23 * Math.PI) / 180;
      this.container.addChild(sprite23.sprite);
    }

    // Main impact animation (sprite_26) at target position
    const sprite26Anchor = calculateAnchor(SPRITE_26_MANIFEST);

    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_26"),
        anchorX: sprite26Anchor.x,
        anchorY: sprite26Anchor.y,
        scale: init.scale,
      })
    );
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound 'grina_709'
    this.impactAnim.onFrame(0, () => {
      this.callbacks.playSound("grina_709");
    });

    // Frame 25 (0-indexed: 24): Play sound 'wab_2006'
    this.impactAnim.onFrame(24, () => {
      this.callbacks.playSound("wab_2006");
    });

    // Frame 34 (0-indexed: 33): this.end() → signal hit
    this.impactAnim.onFrame(33, () => {
      this.signalHit();
    });

    // Frame 97 (0-indexed: 96): removeMovieClip() → complete
    this.impactAnim.onFrame(96, () => {
      this.complete();
    });

    this.container.addChild(this.impactAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.impactAnim.isComplete()) {
      this.complete();
    }
  }
}
