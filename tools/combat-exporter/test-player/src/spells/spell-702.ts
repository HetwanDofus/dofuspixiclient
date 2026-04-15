/**
 * Spell 702 - Grina
 *
 * A multi-component spell with a projectile, impact, and looping/fading effects.
 *
 * Components:
 * - sprite_5: Projectile at caster position, rotated toward target, jumps to random frame (gotoAndStop)
 * - sprite_8: Looping animation at target position, starts at random frame, loops back to frame 2
 * - sprite_9: Impact animation at target position, stops at frame 117 (AS: stop() at frame 118)
 * - sprite_11: Long effect at target position, fades from frame 156 onward, removes at frame 183
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_702'
 * - DefineSprite_5/frame_1: gotoAndStop(random(8) + 1) -> jump to random frame 0-7 (0-indexed), stay there
 * - DefineSprite_8/frame_1: gotoAndPlay(random(100) + 2) -> start at random frame 1-100 (0-indexed)
 * - DefineSprite_8/frame_121: gotoAndPlay(2) -> loop back to frame 1 (0-indexed)
 * - DefineSprite_9/frame_118: stop() -> stop at frame 117 (0-indexed)
 * - DefineSprite_11/frame_157: onClipEvent(enterFrame) -> _parent._alpha -= 3.33 (fade from frame 156 onward)
 * - DefineSprite_11/frame_184: _parent._parent.removeMovieClip() -> animation ends at frame 183 (0-indexed)
 *
 * Hit signal: When sprite_9 stops (frame 117)
 * Complete: When sprite_11 finishes (frame 183)
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE5_MANIFEST: SpriteManifest = {
  width: 159.45,
  height: 44.95,
  offsetX: -104.3,
  offsetY: 0.55,
};

const SPRITE8_MANIFEST: SpriteManifest = {
  width: 122.95,
  height: 68.75,
  offsetX: -53.75,
  offsetY: -36.6,
};

const SPRITE9_MANIFEST: SpriteManifest = {
  width: 290.5,
  height: 162.4,
  offsetX: -129.85,
  offsetY: 19.6,
};

const SPRITE11_MANIFEST: SpriteManifest = {
  width: 195.75,
  height: 109.4,
  offsetX: -88.1,
  offsetY: -59.7,
};

export class Spell702 extends BaseSpell {
  readonly spellId = 702;

  private sprite8Anim!: FrameAnimatedSprite;
  private sprite9Anim!: FrameAnimatedSprite;
  private sprite11Anim!: FrameAnimatedSprite;

  private sprite8Looping = true;
  private sprite11FadeStarted = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play sound immediately (AS frame_1 DoAction)
    this.callbacks.playSound('grina_702');

    // --- sprite_5: Projectile at caster, rotated, shows a random single frame ---
    // AS: gotoAndStop(random(8) + 1) -> random(8) gives 0-7 (0-indexed already covers 0-7)
    const sprite5StartFrame = Math.floor(Math.random() * 8);
    const sprite5Textures = textures.getFrames('sprite_5');
    const sprite5Anchor = calculateAnchor(SPRITE5_MANIFEST);
    const sprite5Anim = this.anims.add(new FrameAnimatedSprite({
      textures: sprite5Textures,
      anchorX: sprite5Anchor.x,
      anchorY: sprite5Anchor.y,
      scale: init.scale,
      startFrame: sprite5StartFrame,
    }));
    sprite5Anim.stopAt(sprite5StartFrame);
    sprite5Anim.sprite.position.set(0, init.casterY);
    sprite5Anim.sprite.rotation = init.angleRad;
    this.container.addChild(sprite5Anim.sprite);

    // --- sprite_8: Looping animation at target, starts at random frame ---
    // AS: gotoAndPlay(random(100) + 2) -> 0-indexed: frame 1 to 100
    const sprite8StartFrame = Math.floor(Math.random() * 100) + 1;
    const sprite8Textures = textures.getFrames('sprite_8');
    const sprite8Anchor = calculateAnchor(SPRITE8_MANIFEST);
    // Not registered with this.anims - managed manually for looping
    this.sprite8Anim = new FrameAnimatedSprite({
      textures: sprite8Textures,
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      scale: init.scale,
      startFrame: sprite8StartFrame,
    });
    this.sprite8Anim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.sprite8Anim.sprite);

    // --- sprite_9: Impact animation at target, stops at frame 117 ---
    // AS: stop() at frame 118 (1-indexed) -> stopAt(117) (0-indexed)
    const sprite9Anchor = calculateAnchor(SPRITE9_MANIFEST);
    this.sprite9Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      scale: init.scale,
    }));
    this.sprite9Anim.stopAt(117);
    this.sprite9Anim.onFrame(117, () => this.signalHit());
    this.sprite9Anim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.sprite9Anim.sprite);

    // --- sprite_11: Long effect at target, fades from frame 156, ends at frame 183 ---
    // AS: frame_184 DoAction -> removeMovieClip() (1-indexed) -> stopAt(183) (0-indexed)
    // AS: frame_157 enterFrame -> _parent._alpha -= 3.33 (1-indexed) -> starts at frame 156 (0-indexed)
    const sprite11Anchor = calculateAnchor(SPRITE11_MANIFEST);
    this.sprite11Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_11'),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      scale: init.scale,
    }));
    this.sprite11Anim.stopAt(183);
    this.sprite11Anim.onFrame(156, () => {
      this.sprite11FadeStarted = true;
    });
    this.sprite11Anim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.sprite11Anim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all registered animations (sprite5, sprite9, sprite11)
    this.anims.update(deltaTime);

    // Manually update sprite_8 with looping logic
    if (this.sprite8Looping) {
      this.sprite8Anim.update(deltaTime);

      // AS: frame_121 DoAction -> gotoAndPlay(2) -> loop back to frame 1 (0-indexed)
      // Frame 120 (0-indexed) = AS frame 121
      if (this.sprite8Anim.isComplete() || this.sprite8Anim.getFrame() >= 120) {
        this.sprite8Anim.gotoFrame(1).play();
      }
    }

    // Apply fading to sprite_11 once fade has started
    // AS: onClipEvent(enterFrame) { _parent._alpha -= 3.33; }
    // Flash _alpha is 0-100, PixiJS alpha is 0-1, so decrement by 3.33/100
    if (this.sprite11FadeStarted) {
      this.sprite11Anim.sprite.alpha = Math.max(0, this.sprite11Anim.sprite.alpha - 3.33 / 100);
    }

    // Complete when sprite_11 stops at frame 183
    if (this.sprite11Anim.isStopped() || this.sprite11Anim.isComplete()) {
      this.sprite8Looping = false;
      this.complete();
    }
  }

  destroy(): void {
    this.sprite8Anim.destroy();
    super.destroy();
  }
}
