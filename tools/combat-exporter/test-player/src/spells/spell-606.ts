/**
 * Spell 606
 *
 * A single animation (anim1) played at the target position with 150 frames.
 *
 * Components:
 * - anim1: Main animation at target position, 150 frames
 *
 * Original AS timing:
 * - DefineSprite_7 clip (onClipEvent enterFrame): _alpha = random(20) + 80; _rotation = random(360)
 *   This is a sub-sprite within the main animation; represented as per-frame random alpha/rotation
 *   on the main sprite since we flatten into a single composite animation.
 * - DefineSprite_19 frame_1: gotoAndPlay(random(9) + 2) — internal loop randomization
 * - DefineSprite_19 frame_4: _rotation = random(360)
 * - DefineSprite_19 frame_28: gotoAndPlay(2)
 * - DefineSprite_23 frame_115 clip (onClipEvent enterFrame): _alpha = random(20) + 80; _rotation = random(360)
 * - DefineSprite_23 frame_148 (0-indexed: 147): _parent.removeMovieClip() → complete
 *
 * The composite animation (anim1) bakes all sub-sprite behavior. The main timeline
 * has 150 frames. Frame 148 (1-indexed) = index 147 triggers removeMovieClip → complete.
 * Hit is signaled when the animation completes (frame 147, 0-indexed).
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 121.6,
  height: 144.5,
  offsetX: -92.05,
  offsetY: -134.35,
};

export class Spell606 extends BaseSpell {
  readonly spellId = 606;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 147 (0-indexed) = AS frame 148: _parent.removeMovieClip() → signal hit and complete
    this.mainAnim.onFrame(147, () => {
      this.signalHit();
    });

    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}
