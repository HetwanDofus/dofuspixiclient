/**
 * Spell 903 - Jet (Feca)
 *
 * A composite animation spell with a single animation that plays through.
 *
 * Components:
 * - anim1: Main composite animation at target position (75 frames)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'jet_903'
 * - Frame 13 (DefineSprite_11): Signal hit (this.end())
 * - Frame 73 (DefineSprite_11): removeMovieClip() - animation ends
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
  width: 197.95,
  height: 102.2,
  offsetX: 7.1,
  offsetY: -52.55,
};

export class Spell903 extends BaseSpell {
  readonly spellId = 903;

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

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound("jet_903"))
      .onFrame(12, () => this.signalHit())
      .stopAt(72);

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
