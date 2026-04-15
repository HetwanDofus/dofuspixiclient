/**
 * Spell 1207
 *
 * An impact spell placed at the target cell.
 *
 * Components:
 * - sprite_30: Main composite animation at target position, randomly x-flipped
 *   - Contains two sprite_29 sub-animations (rain/flicker effects)
 *   - Signals hit at frame 43 (AS frame 43 -> index 42)
 *   - Removes at frame 94 (AS frame 94 -> index 93)
 * - sprite_10: Looping ambient sprite, starts at random frame, cycles at frame 73
 *
 * Original AS timing:
 * - Main timeline frame 2: Place sprite_30 at cellTo position, stop()
 * - DefineSprite_30 frame 1: Randomly flip xscale
 * - DefineSprite_30 frame 43: this.end() -> signal hit
 * - DefineSprite_30 frame 94: removeMovieClip() -> animation ends
 * - DefineSprite_29 frame 1: onEnterFrame sets _alpha = 20 + random(20)
 * - DefineSprite_29 instances: start at frame 3 and frame 4 respectively
 * - DefineSprite_10 frame 1: gotoAndPlay(random(60) + 1) -> random start
 * - DefineSprite_10 frame 73: gotoAndPlay(3) -> loop from frame 3
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 18.2,
  height: 28.9,
  offsetX: -8,
  offsetY: -16.5,
};

const SPRITE_29_MANIFEST: SpriteManifest = {
  width: 177.4,
  height: 166.8,
  offsetX: -77.5,
  offsetY: -102.8,
};

const SPRITE_30_MANIFEST: SpriteManifest = {
  width: 144.05,
  height: 135.2,
  offsetX: -33.25,
  offsetY: -94.05,
};

/**
 * LoopingFrameAnimatedSprite wraps FrameAnimatedSprite to support
 * looping from a specific frame (AS: gotoAndPlay(3) at frame 73).
 * We manage this manually in the update loop.
 */
class LoopingSprite {
  readonly anim: FrameAnimatedSprite;
  private loopFromFrame: number;
  private loopAtFrame: number;

  constructor(anim: FrameAnimatedSprite, loopFromFrame: number, loopAtFrame: number) {
    this.anim = anim;
    this.loopFromFrame = loopFromFrame;
    this.loopAtFrame = loopAtFrame;
  }

  update(deltaTime: number): void {
    this.anim.update(deltaTime);
    // When we reach the loop frame, jump back to loopFromFrame
    if (this.anim.getFrame() >= this.loopAtFrame) {
      this.anim.gotoFrame(this.loopFromFrame);
    }
  }
}

/**
 * FlickerSprite simulates DefineSprite_29's onEnterFrame alpha flicker:
 * _alpha = 20 + random(20)
 */
class FlickerSprite {
  readonly anim: FrameAnimatedSprite;

  constructor(anim: FrameAnimatedSprite) {
    this.anim = anim;
  }

  update(deltaTime: number): void {
    this.anim.update(deltaTime);
    // AS: _alpha = 20 + random(20)  (0..19 -> 20..39 out of 100)
    const alpha = (20 + Math.floor(Math.random() * 20)) / 100;
    this.anim.sprite.alpha = alpha;
  }
}

export class Spell1207 extends BaseSpell {
  readonly spellId = 1207;

  private mainAnim!: FrameAnimatedSprite;
  private loopingSprite!: LoopingSprite;
  private flickerA!: FlickerSprite;
  private flickerB!: FlickerSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const sprite10Anchor = calculateAnchor(SPRITE_10_MANIFEST);
    const sprite29Anchor = calculateAnchor(SPRITE_29_MANIFEST);
    const sprite30Anchor = calculateAnchor(SPRITE_30_MANIFEST);

    // ---- sprite_10: looping ambient sprite at target position ----
    // AS frame 1: gotoAndPlay(random(60) + 1) -> 0-indexed: random(60)+1-1 = random frame 0..59
    // AS frame 73: gotoAndPlay(3) -> loop back to frame 2 (0-indexed)
    const sprite10StartFrame = Math.floor(Math.random() * 60);
    const rawSprite10Anim = new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      scale: init.scale,
      startFrame: sprite10StartFrame,
    });
    rawSprite10Anim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(rawSprite10Anim.sprite);
    // We manage this sprite manually (looping), not via this.anims
    this.loopingSprite = new LoopingSprite(rawSprite10Anim, 2, 72);

    // ---- sprite_29 instances (sub-animations inside sprite_30) ----
    // PlaceObject2_29_1: gotoAndPlay(4) -> startFrame 3 (0-indexed)
    // PlaceObject2_29_39: gotoAndPlay(3) -> startFrame 2 (0-indexed)
    // Both flicker alpha every frame: _alpha = 20 + random(20)

    const flickerAnim_A_raw = new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_29'),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
      scale: init.scale,
      startFrame: 3,
      // AS frame 61: stop() -> stopFrame 60 (0-indexed)
      stopFrame: 60,
    });

    const flickerAnim_B_raw = new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_29'),
      anchorX: sprite29Anchor.x,
      anchorY: sprite29Anchor.y,
      scale: init.scale,
      startFrame: 2,
      stopFrame: 60,
    });

    this.flickerA = new FlickerSprite(flickerAnim_A_raw);
    this.flickerB = new FlickerSprite(flickerAnim_B_raw);

    // ---- sprite_30: main composite animation at target position ----
    // AS frame 1: randomly flip xscale
    // AS frame 43: this.end() -> signal hit (0-indexed: 42)
    // AS frame 94: removeMovieClip() -> done (0-indexed: 93)
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_30'),
      anchorX: sprite30Anchor.x,
      anchorY: sprite30Anchor.y,
      scale: init.scale,
      // stopFrame is 93 (AS frame 94 -> index 93)
      stopFrame: 93,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // AS: if(random(2) == 1) { _xscale = -_xscale; }
    if (Math.floor(Math.random() * 2) === 1) {
      this.mainAnim.sprite.scale.x = -this.mainAnim.sprite.scale.x;
    }

    // Signal hit at frame 42 (AS frame 43)
    this.mainAnim.onFrame(42, () => this.signalHit());

    // Build composite container: sprite_30 contains the sprite_29 sub-sprites
    // We add the sub-sprites as children of a container placed at target
    const compositeContainer = new Container();
    compositeContainer.position.set(init.targetX, init.targetY);

    // Add sub-animation sprites to container
    compositeContainer.addChild(flickerAnim_A_raw.sprite);
    compositeContainer.addChild(flickerAnim_B_raw.sprite);
    this.container.addChild(compositeContainer);
    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update looping ambient sprite
    this.loopingSprite.update(deltaTime);

    // Update flickering sub-animations
    this.flickerA.update(deltaTime);
    this.flickerB.update(deltaTime);

    // Update main animation
    this.anims.update(deltaTime);

    // Complete when main animation reaches its stop frame (index 93)
    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      this.complete();
    }
  }
}
