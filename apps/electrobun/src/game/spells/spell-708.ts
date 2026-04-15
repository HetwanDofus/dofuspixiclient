/**
 * Spell 708 - Grina
 *
 * A single composite animation that plays at the target position.
 *
 * Components:
 * - anim1: 105-frame composite animation at target position
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_701'
 * - Frame 103 (DefineSprite_22): removeMovieClip() - animation ends
 * - DefineSprite_13: loops with random start frame (random(31)+2, 0-indexed: 1-31)
 * - DefineSprite_20: random rotation on load (-random(180))
 * - DefineSprite_21 instances: random start frames
 * - DefineSprite_15: rotation += 1.6 per frame
 *
 * The main animation plays through all 105 frames and completes.
 * Hit is signaled at frame 103 (0-indexed: 102) when the inner sprite removes itself.
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
  width: 138.75,
  height: 68.1,
  offsetX: -64.35,
  offsetY: -34.05,
};

export class Spell708 extends BaseSpell {
  readonly spellId = 708;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: calculateAnchor(ANIM1_MANIFEST).x,
        anchorY: calculateAnchor(ANIM1_MANIFEST).y,
        scale: init.scale,
      })
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    anim
      .onFrame(0, () => this.callbacks.playSound("grina_701"))
      .onFrame(102, () => this.signalHit());

    this.container.addChild(anim.sprite);
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
