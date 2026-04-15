/**
 * Spell 312 - Arty (Sadida)
 *
 * A single composite animation that plays at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, 279 frames
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'arty_101'
 * - Frame 277 (DefineSprite_9): removeMovieClip() - animation ends
 *   (DefineSprite_9 is the inner sprite; frame 277 = index 276)
 *
 * The animation contains several inner sprites with randomized properties:
 * - DefineSprite_4 children: random rotation, scale, alpha (static on load)
 * - DefineSprite_7 children: random scale (50-100%), rotation velocity (5-19 deg/frame), alpha (40-99%)
 * - DefineSprite_8 children: oscillating X/Y movement with fade in/out
 *
 * Since anim1 is a composite (pre-rendered), all inner sprite behavior is
 * baked into the frames. We simply play anim1 through to completion.
 *
 * Hit is signaled at frame 0 (instant spell - hits on cast).
 * Animation completes when anim1 finishes all 279 frames (index 278).
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
  width: 80,
  height: 78.45,
  offsetX: -43.55,
  offsetY: -50.1,
};

export class Spell312 extends BaseSpell {
  readonly spellId = 312;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound("arty_101");
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
