/**
 * Spell 1207 - Unknown
 *
 * Multi-layered impact effect positioned at target cell with alpha variations.
 *
 * Components:
 * - sprite_10: Looping background effect with randomized start (frame 1-60)
 * - sprite_29: Two instances with alpha flicker (20-40%) 
 * - sprite_30: Main impact animation with random horizontal flip
 *
 * Original AS timing:
 * - Frame 1: sprite_10 jumps to random frame 1-60
 * - Frame 43: Signal hit (this.end())
 * - Frame 61: sprite_29 stops
 * - Frame 73: sprite_10 loops back to frame 3
 * - Frame 94: sprite_30 stops
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 109.2,
  height: 173.4,
  offsetX: -48,
  offsetY: -99,
};

const SPRITE_29_MANIFEST: SpriteManifest = {
  width: 1064.4,
  height: 1000.8,
  offsetX: -465,
  offsetY: -616.8,
};

const SPRITE_30_MANIFEST: SpriteManifest = {
  width: 864.3,
  height: 811.2,
  offsetX: -199.5,
  offsetY: -564.3,
};

export class Spell1207 extends BaseSpell {
  readonly spellId = 1207;

  private sprite10!: FrameAnimatedSprite;
  private sprite29_1!: FrameAnimatedSprite;
  private sprite29_2!: FrameAnimatedSprite;
  private sprite30!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // sprite_10: Background looping effect with random start
    this.sprite10 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      ...calculateAnchor(SPRITE_10_MANIFEST),
      scale: init.scale,
      // AS: gotoAndPlay(random(60) + 1) -> 0-indexed: 0-59
      startFrame: Math.floor(Math.random() * 60),
    }));
    this.sprite10.sprite.position.set(init.targetX, init.targetY);
    // AS frame 73: gotoAndPlay(3) -> loop to frame 2 (0-indexed)
    this.sprite10.onFrame(72, () => this.sprite10.jumpToFrame(2));
    this.container.addChild(this.sprite10.sprite);

    // sprite_30: Main impact animation
    this.sprite30 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_30'),
      ...calculateAnchor(SPRITE_30_MANIFEST),
      scale: init.scale,
    }));
    this.sprite30.sprite.position.set(init.targetX, init.targetY);
    // AS: if(random(2) == 1) _xscale = -_xscale
    if (Math.floor(Math.random() * 2) === 1) {
      this.sprite30.sprite.scale.x *= -1;
    }
    this.sprite30
      .stopAt(93) // AS frame 94 -> 0-indexed 93
      .onFrame(42, () => this.signalHit()); // AS frame 43 -> 0-indexed 42
    this.container.addChild(this.sprite30.sprite);

    // sprite_29 instance 1: starts at frame 4
    this.sprite29_1 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_29'),
      ...calculateAnchor(SPRITE_29_MANIFEST),
      scale: init.scale,
      // AS: gotoAndPlay(4) -> 0-indexed: 3
      startFrame: 3,
    }));
    this.sprite29_1.sprite.position.set(init.targetX, init.targetY);
    this.sprite29_1.stopAt(60); // AS frame 61 -> 0-indexed 60
    this.container.addChild(this.sprite29_1.sprite);

    // sprite_29 instance 2: starts at frame 3
    this.sprite29_2 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_29'),
      ...calculateAnchor(SPRITE_29_MANIFEST),
      scale: init.scale,
      // AS: gotoAndPlay(3) -> 0-indexed: 2
      startFrame: 2,
    }));
    this.sprite29_2.sprite.position.set(init.targetX, init.targetY);
    this.sprite29_2.stopAt(60); // AS frame 61 -> 0-indexed 60
    this.container.addChild(this.sprite29_2.sprite);

    // Apply alpha flicker effect to both sprite_29 instances
    // AS: _alpha = 20 + random(20) -> 20-40%
    const flickerAlpha = () => (20 + Math.floor(Math.random() * 20)) / 100;
    this.sprite29_1.sprite.alpha = flickerAlpha();
    this.sprite29_2.sprite.alpha = flickerAlpha();

    // Update alpha every frame for flicker effect
    this.sprite29_1.onEveryFrame(() => {
      this.sprite29_1.sprite.alpha = flickerAlpha();
    });
    this.sprite29_2.onEveryFrame(() => {
      this.sprite29_2.sprite.alpha = flickerAlpha();
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete when sprite_30 stops (main animation)
    if (this.sprite30.isStopped()) {
      this.complete();
    }
  }
}