/**
 * Spell 314
 *
 * A composite animation effect at the target position.
 * Contains 6 sub-animations (DefineSprite_17 instances) placed within
 * a container (DefineSprite_18), each starting at a random frame offset.
 * The outer container (DefineSprite_20) removes itself at frame 82.
 *
 * Components:
 * - anim1 (composite): 6 sub-instances at target, each with random start frame
 *   - 5 instances: random(20) start frame (0-19)
 *   - 1 instance (PlaceObject2_17_7): random(30) start frame (0-29)
 *
 * Each sub-instance (DefineSprite_17) has an onEnterFrame that accelerates
 * playback: starts at t=0, every 20 frames increments t, jumping ahead t frames
 * each tick. This acceleration effect is baked into the composite anim1 frames.
 *
 * Original AS timing:
 * - Frame 82 (DefineSprite_20): removeMovieClip() -> animation ends
 * - Hit signal: at start (frame 0) since it's an instant area effect
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 193.45,
  height: 186.35,
  offsetX: -95.55,
  offsetY: -149.35,
};

// 6 sub-instances placed in DefineSprite_18 frame 1:
// PlaceObject2_17_1, _7, _13, _19, _25, _31
// _7 uses random(30), all others use random(20)
const INSTANCE_RANDOM_RANGES = [20, 30, 20, 20, 20, 20];

export class Spell314 extends BaseSpell {
  readonly spellId = 314;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);
    const anim1Textures = textures.getFrames('anim1');

    // Signal hit immediately (instant effect at target)
    this.signalHit();

    // Create 6 sub-instances of the anim1 animation, each with a random start frame
    // matching the DefineSprite_17 instances in DefineSprite_18
    for (let i = 0; i < INSTANCE_RANDOM_RANGES.length; i++) {
      const range = INSTANCE_RANDOM_RANGES[i];
      // AS: gotoAndPlay(random(N)) -> 0-indexed start frame 0..N-1
      const startFrame = Math.floor(Math.random() * range);

      const anim = this.anims.add(
        new FrameAnimatedSprite({
          textures: anim1Textures,
          anchorX: anchor.x,
          anchorY: anchor.y,
          scale: init.scale,
          startFrame,
          // DefineSprite_20 removes itself at frame 82 (0-indexed: 81)
          stopFrame: 81,
          loop: true,
        }),
      );

      anim.sprite.position.set(init.targetX, init.targetY);
      this.container.addChild(anim.sprite);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
