/**
 * Spell 714 - Grina
 *
 * A multi-component spell with several animated sprites at the target position.
 *
 * Components:
 * - sprite_5: Background/base animation at target position (58 frames, plays through)
 * - sprite_6: Small looping sprite at target, starts at random frame (random(8)+1, loops 6 frames)
 * - sprite_7: Large impact sprite at target (57 frames, plays through)
 * - sprite_9: Looping effect at target, starts at random frame then loops (123 frames)
 * - sprite_10: Ground effect at target, stops at frame 118
 * - sprite_12: Fading effect at target, alpha fades from frame 157, removeMovieClip at frame 184
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_702'
 * - Frame 1 (sprite_6): gotoAndStop(random(8) + 1) -> stop at random frame 1-8 (0-indexed: 0-7)
 * - Frame 1 (sprite_9): gotoAndPlay(random(100) + 2) -> start at random frame 2-101 (0-indexed: 1-100)
 * - Frame 121 (sprite_9): gotoAndPlay(2) -> loop back to frame 2 (0-indexed: 1)
 * - Frame 118 (sprite_10): stop()
 * - Frame 157 (sprite_12, enterFrame): _parent._alpha -= 3.33 per frame
 * - Frame 184 (sprite_12): removeMovieClip() -> animation ends
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_6_MANIFEST: SpriteManifest = {
  width: 159.45,
  height: 115.5,
  offsetX: -104.3,
  offsetY: -70,
};

const SPRITE_7_MANIFEST: SpriteManifest = {
  width: 168.05,
  height: 215.9,
  offsetX: -69.1,
  offsetY: -78.8,
};

const SPRITE_9_MANIFEST: SpriteManifest = {
  width: 127.6,
  height: 71.4,
  offsetX: -56.05,
  offsetY: -37.95,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 301.45,
  height: 168.65,
  offsetX: -135.25,
  offsetY: 16.4,
};

const SPRITE_12_MANIFEST: SpriteManifest = {
  width: 203.1,
  height: 113.6,
  offsetX: -91.7,
  offsetY: -61.85,
};

export class Spell714 extends BaseSpell {
  readonly spellId = 714;

  private sprite12Anim!: FrameAnimatedSprite;
  private sprite12AlphaFrame = 0;
  private sprite12FadingStarted = false;
  private sprite12Done = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play sound at frame 1 (immediately)
    this.callbacks.playSound('grina_702');

    const tx = init.targetX;
    const ty = init.targetY;

    // sprite_5: 58 frames, no manifest data (width/height = 0), anchor = 0.5 default
    const sprite5Textures = textures.getFrames('sprite_5');
    const sprite5Anim = this.anims.add(new FrameAnimatedSprite({
      textures: sprite5Textures,
      fps: 60,
      anchorX: 0.5,
      anchorY: 0.5,
      scale: init.scale,
    }));
    sprite5Anim.sprite.position.set(tx, ty);
    this.container.addChild(sprite5Anim.sprite);

    // sprite_6: 6 frames, gotoAndStop(random(8) + 1) -> 0-indexed: random(8) + 0 = 0..7, but clamped to 0-5
    const sprite6Textures = textures.getFrames('sprite_6');
    const sprite6Anchor = calculateAnchor(SPRITE_6_MANIFEST);
    // AS: gotoAndStop(random(8) + 1), frames 1-8. The sprite only has 6 frames so clamp to 0-5.
    const sprite6StartFrame = Math.min(Math.floor(Math.random() * 8), sprite6Textures.length - 1);
    const sprite6Anim = this.anims.add(new FrameAnimatedSprite({
      textures: sprite6Textures,
      fps: 60,
      anchorX: sprite6Anchor.x,
      anchorY: sprite6Anchor.y,
      scale: init.scale,
      startFrame: sprite6StartFrame,
      stopFrame: sprite6StartFrame,
    }));
    sprite6Anim.sprite.position.set(tx, ty);
    this.container.addChild(sprite6Anim.sprite);

    // sprite_7: 57 frames, plays through
    const sprite7Textures = textures.getFrames('sprite_7');
    const sprite7Anchor = calculateAnchor(SPRITE_7_MANIFEST);
    const sprite7Anim = this.anims.add(new FrameAnimatedSprite({
      textures: sprite7Textures,
      fps: 60,
      anchorX: sprite7Anchor.x,
      anchorY: sprite7Anchor.y,
      scale: init.scale,
    }));
    sprite7Anim.sprite.position.set(tx, ty);
    this.container.addChild(sprite7Anim.sprite);

    // sprite_9: 123 frames, starts at random frame (random(100) + 2 -> 0-indexed: 1..100)
    // At frame 121 (0-indexed: 120): gotoAndPlay(2) -> 0-indexed: 1 (loop)
    const sprite9Textures = textures.getFrames('sprite_9');
    const sprite9Anchor = calculateAnchor(SPRITE_9_MANIFEST);
    // AS: gotoAndPlay(random(100) + 2) -> frames 2..101 -> 0-indexed: 1..100
    const sprite9StartFrame = Math.floor(Math.random() * 100) + 1;
    const sprite9Anim = this.anims.add(new FrameAnimatedSprite({
      textures: sprite9Textures,
      fps: 60,
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      scale: init.scale,
      startFrame: sprite9StartFrame,
      loop: true,
    }));
    sprite9Anim.sprite.position.set(tx, ty);
    // Frame 121 (0-indexed: 120): gotoAndPlay(2) -> jump to frame index 1
    // We handle this by using loop=true and the loop back to frame 0 won't match AS exactly,
    // but the AS loops back to frame 2 (0-indexed: 1) at frame 121 (0-indexed: 120).
    // Since FrameAnimatedSprite loops to 0, we need to handle the loop manually.
    // We'll use a frame callback to jump back to frame 1 when reaching frame 120.
    sprite9Anim.onFrame(120, () => {
      sprite9Anim.gotoFrame(1);
    }, false);
    this.container.addChild(sprite9Anim.sprite);

    // sprite_10: 120 frames, stops at frame 118 (0-indexed: 117)
    const sprite10Textures = textures.getFrames('sprite_10');
    const sprite10Anchor = calculateAnchor(SPRITE_10_MANIFEST);
    const sprite10Anim = this.anims.add(new FrameAnimatedSprite({
      textures: sprite10Textures,
      fps: 60,
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      scale: init.scale,
      stopFrame: 117,
    }));
    sprite10Anim.sprite.position.set(tx, ty);
    this.container.addChild(sprite10Anim.sprite);

    // sprite_12: 186 frames
    // Frame 157 (0-indexed: 156): enterFrame clip action: _parent._alpha -= 3.33 per frame
    // Frame 184 (0-indexed: 183): removeMovieClip -> animation ends
    const sprite12Textures = textures.getFrames('sprite_12');
    const sprite12Anchor = calculateAnchor(SPRITE_12_MANIFEST);
    this.sprite12Anim = this.anims.add(new FrameAnimatedSprite({
      textures: sprite12Textures,
      fps: 60,
      anchorX: sprite12Anchor.x,
      anchorY: sprite12Anchor.y,
      scale: init.scale,
    }));
    this.sprite12Anim.sprite.position.set(tx, ty);
    // At frame 156 (0-indexed), start fading
    this.sprite12Anim.onFrame(156, () => {
      this.sprite12FadingStarted = true;
      this.sprite12AlphaFrame = 0;
    });
    // At frame 183 (0-indexed), mark done and signal complete
    this.sprite12Anim.onFrame(183, () => {
      this.sprite12Done = true;
      this.sprite12Anim.sprite.visible = false;
      this.signalHit();
      this.complete();
    });
    this.container.addChild(this.sprite12Anim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Handle sprite_12 alpha fading
    // The enterFrame event fires every frame once fading starts (from frame 157, 0-indexed 156 onward)
    // We need to apply -3.33 alpha per frame. Since update() is called with deltaTime (ms),
    // we need to track how many frames have passed since fading started.
    if (this.sprite12FadingStarted && !this.sprite12Done) {
      // Calculate frames elapsed since last update
      const framesThisUpdate = deltaTime / (1000 / 60);
      this.sprite12AlphaFrame += framesThisUpdate;

      // Apply alpha reduction: -3.33 per frame (AS alpha is 0-100, PixiJS is 0-1)
      // AS: _parent._alpha -= 3.33 -> so alpha decreases by 3.33% per frame
      const currentAlpha = this.sprite12Anim.sprite.alpha;
      const newAlpha = Math.max(0, currentAlpha - (3.33 / 100) * framesThisUpdate);
      this.sprite12Anim.sprite.alpha = newAlpha;
    }

    if (this.sprite12Done) {
      this.complete();
    }
  }
}
