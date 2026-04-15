/**
 * Spell 1104 - Autre
 *
 * Two looping animations (DefineSprite_4 and DefineSprite_5) displayed at the
 * target position. Both start at a random frame and loop with different loop
 * points. The spell signals hit at frame 137 and removes itself at frame 159.
 *
 * Components:
 * - anim1 (DefineSprite_4): Starts at random(40)+2 (0-indexed: 1-40),
 *   loops from frame 95 back to frame 44 (0-indexed: 94 → 43)
 * - anim1 (DefineSprite_5): Starts at random(40)+2 (0-indexed: 1-40),
 *   loops from frame 85 back to frame 56 (0-indexed: 84 → 55)
 *
 * Main timeline:
 * - Frame 1: Play sound 'autre_1104'
 * - Frame 137: this.end() → signal hit
 * - Frame 159: removeMovieClip() → complete
 *
 * Both sprites share the same anim1 texture strip.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  SPELL_CONSTANTS,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 99.95,
  height: 59.05,
  offsetX: -49.95,
  offsetY: -20.25,
};

export class Spell1104 extends BaseSpell {
  readonly spellId = 1104;

  // Main timeline accumulator (runs at 60 fps alongside the sprites)
  private mainFrameAccumulator = 0;
  private mainFrame = 0;
  private hitSignaledMain = false;
  private sprite4Anim!: FrameAnimatedSprite;
  private sprite5Anim!: FrameAnimatedSprite;

  // Per-sprite loop state for sprite_4
  private sprite4Frame = 0;
  private sprite4Accumulator = 0;

  // Per-sprite loop state for sprite_5
  private sprite5Frame = 0;
  private sprite5Accumulator = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anim1Textures = textures.getFrames('anim1');
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Play sound at frame 1 (index 0) of the main timeline
    this.callbacks.playSound('autre_1104');

    // --- DefineSprite_4 ---
    // Starts at gotoAndPlay(random(40) + 2) → 0-indexed: Math.floor(Math.random()*40) + 1
    const sprite4StartFrame = Math.floor(Math.random() * 40) + 1;
    this.sprite4Frame = sprite4StartFrame;

    this.sprite4Anim = new FrameAnimatedSprite({
      textures: anim1Textures,
      fps: SPELL_CONSTANTS.FPS,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      startFrame: sprite4StartFrame,
      loop: false,
    });
    this.sprite4Anim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.sprite4Anim.sprite);

    // --- DefineSprite_5 ---
    // Starts at gotoAndPlay(random(40) + 2) → 0-indexed: Math.floor(Math.random()*40) + 1
    const sprite5StartFrame = Math.floor(Math.random() * 40) + 1;
    this.sprite5Frame = sprite5StartFrame;

    this.sprite5Anim = new FrameAnimatedSprite({
      textures: anim1Textures,
      fps: SPELL_CONSTANTS.FPS,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      startFrame: sprite5StartFrame,
      loop: false,
    });
    this.sprite5Anim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.sprite5Anim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // --- Main timeline tracking ---
    this.mainFrameAccumulator += deltaTime;
    const frameTime = SPELL_CONSTANTS.FRAME_TIME;

    while (this.mainFrameAccumulator >= frameTime) {
      this.mainFrameAccumulator -= frameTime;
      this.mainFrame++;

      // Frame 137 (0-indexed 136): signal hit
      if (this.mainFrame === 136 && !this.hitSignaledMain) {
        this.hitSignaledMain = true;
        this.signalHit();
      }

      // Frame 159 (0-indexed 158): complete
      if (this.mainFrame >= 158) {
        this.complete();
        return;
      }
    }

    // --- DefineSprite_4 manual loop update ---
    this.sprite4Accumulator += deltaTime;
    while (this.sprite4Accumulator >= frameTime) {
      this.sprite4Accumulator -= frameTime;
      this.sprite4Frame++;

      // At frame 95 (0-indexed 94): gotoAndPlay(44) → 0-indexed 43
      if (this.sprite4Frame >= 94) {
        this.sprite4Frame = 43;
      }

      if (this.sprite4Frame < this.sprite4Anim.textures.length) {
        this.sprite4Anim.gotoFrame(this.sprite4Frame);
      }
    }

    // --- DefineSprite_5 manual loop update ---
    this.sprite5Accumulator += deltaTime;
    while (this.sprite5Accumulator >= frameTime) {
      this.sprite5Accumulator -= frameTime;
      this.sprite5Frame++;

      // At frame 85 (0-indexed 84): gotoAndPlay(56) → 0-indexed 55
      if (this.sprite5Frame >= 84) {
        this.sprite5Frame = 55;
      }

      if (this.sprite5Frame < this.sprite5Anim.textures.length) {
        this.sprite5Anim.gotoFrame(this.sprite5Frame);
      }
    }
  }
}
