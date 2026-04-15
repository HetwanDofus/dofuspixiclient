/**
 * Spell 712 - Grina
 *
 * A single composite animation played at the target position.
 *
 * Components:
 * - anim1: 135-frame composite animation at target position, stops at frame 132
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'grina_704'
 * - Frame 133 (DefineSprite_9): stop() + removeMovieClip() → animation ends
 *   (manifest stopFrame = 132, 0-indexed)
 *
 * Notes:
 * - DefineSprite_3 randomly picks a frame (random(3)+1) - baked into composite frames
 * - DefineSprite_5 trajectory randomization - baked into composite frames
 * - DefineSprite_9 alpha fade on enterFrame (_alpha -= 2.3) - baked into composite
 * - The manifest isComposite:true and stopFrame:132 match AS stop() at frame 133
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
  width: 390.9,
  height: 224.75,
  offsetX: -198.15,
  offsetY: -175.9,
};

export class Spell712 extends BaseSpell {
  readonly spellId = 712;

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
        stopFrame: 132,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound("grina_704"))
      .onFrame(132, () => this.signalHit());

    this.container.addChild(this.mainAnim.sprite);
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
