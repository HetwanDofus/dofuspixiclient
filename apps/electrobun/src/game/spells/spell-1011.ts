/**
 * Spell 1011 - Pet (Eniripsa)
 *
 * A composite animation with randomized scale and rotation instances.
 *
 * Components:
 * - anim1 (composite): At target position, signals hit at frame 9, stops at frame 69
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'pet'
 * - Frame 1 (DefineSprite_4): Set random scale (100-200%) and random rotation (0-359°)
 * - Frame 10 (DefineSprite_10): this.end() → signal hit
 * - Frame 19 (DefineSprite_4): stop()
 * - Frame 46 (DefineSprite_7): stop()
 * - Frame 64 (DefineSprite_9): stop()
 * - Frame 70 (DefineSprite_10): stop() + removeMovieClip() → animation ends
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
  width: 205.7,
  height: 109.85,
  offsetX: -103.3,
  offsetY: -56.6,
};

export class Spell1011 extends BaseSpell {
  readonly spellId = 1011;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // AS DefineSprite_4/frame_1: t = 100 + random(100); _xscale = t; _yscale = t; _rotation = random(360);
    const t = 100 + Math.floor(Math.random() * 100);
    const asScale = t / 100;
    const rotation = Math.floor(Math.random() * 360);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale * asScale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.mainAnim.sprite.rotation = (rotation * Math.PI) / 180;

    // Frame 0 (AS frame 1): play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound("pet"));

    // Frame 9 (AS frame 10): this.end() → signal hit
    this.mainAnim.onFrame(9, () => this.signalHit());

    // Frame 69 (AS frame 70): stop() + removeMovieClip()
    this.mainAnim.stopAt(69);
    this.mainAnim.onFrame(69, () => this.complete());

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
