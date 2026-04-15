/**
 * Spell 410 - Explosion
 *
 * A single animation that plays at the target position.
 *
 * Components:
 * - anim1 (DefineSprite_8 containing DefineSprite_6 instances): At target position
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'explosion'
 * - Frame 1 (DefineSprite_6): Random rotation, random scale (30-79%)
 * - Frame 52 (DefineSprite_6): stop()
 * - Frame 94 (DefineSprite_8): removeMovieClip() - animation ends
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
  width: 221,
  height: 58.45,
  offsetX: -54.85,
  offsetY: -50.05,
};

export class Spell410 extends BaseSpell {
  readonly spellId = 410;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // AS: DefineSprite_6 frame_1: _rotation = random(360); t = random(50) + 30; _xscale = t; _yscale = t;
    // The composite animation (anim1) already bakes these per-frame visuals.
    // The overall animation is placed at the target position.
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (main timeline, 0-indexed: 0): Play sound 'explosion'
    this.mainAnim.onFrame(0, () => this.callbacks.playSound("explosion"));

    // Frame 94 (DefineSprite_8, 0-indexed: 93): removeMovieClip -> animation ends
    // Signal hit when the impact occurs (at start of animation)
    this.mainAnim.onFrame(0, () => this.signalHit());

    // Stop at frame 94 (0-indexed: 93) - removeMovieClip
    this.mainAnim.stopAt(93);

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
