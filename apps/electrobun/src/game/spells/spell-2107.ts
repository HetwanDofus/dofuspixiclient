/**
 * Spell 2107 - Arty (Baton/Staff spell)
 *
 * A single animation played at the target position.
 *
 * Components:
 * - anim1: Main animation at target position, stops at frame 48
 *
 * Original AS timing:
 * - Frame 1 (main timeline): Play sound 'arty_102'
 * - Frame 172 (main timeline): removeMovieClip() - animation ends
 * - anim1 stopFrame: 48 (0-indexed)
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
  width: 138.55,
  height: 91.55,
  offsetX: -70.4,
  offsetY: -73.5,
};

export class Spell2107 extends BaseSpell {
  readonly spellId = 2107;

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
        stopFrame: 48,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    this.mainAnim
      .onFrame(0, () => this.callbacks.playSound("arty_102"))
      .onFrame(0, () => this.signalHit());

    this.mainAnim.addTo(this.container);
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
