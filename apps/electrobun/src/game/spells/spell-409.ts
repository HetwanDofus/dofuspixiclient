/**
 * Spell 409 - Lakam
 *
 * A composite animation spell played at the target position.
 *
 * Components:
 * - anim1 (composite): Full animation at target position, stops at frame 147
 *
 * The animation internally contains particle-like sub-sprites (DefineSprite_5)
 * that each start at a random rotation, random scale, and random frame offset,
 * playing until frame 127 then stopping. DefineSprite_7 removes itself at frame 148.
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'lakam_409'
 * - Frame 31 (DefineSprite_5): Play sound 'lakam_409'
 * - Frame 127 (DefineSprite_5): stop()
 * - Frame 148 (DefineSprite_7): removeMovieClip() / stop()
 * - stopFrame from manifest: 147 (0-indexed)
 *
 * Because the composite animation is pre-rendered into frames by the exporter,
 * we simply play anim1 from frame 0, stop at frame 147, signal hit at frame 30
 * (the second sound / impact moment), and complete when the animation stops.
 *
 * Sound triggers (0-indexed frames):
 * - Frame 0: 'lakam_409'
 * - Frame 30: 'lakam_409'
 *
 * Hit signal: frame 30 (second sound, corresponds to impact)
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
  width: 163.1,
  height: 111.65,
  offsetX: 2.1,
  offsetY: -70.7,
};

export class Spell409 extends BaseSpell {
  readonly spellId = 409;

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
      .stopAt(147)
      .onFrame(0, () => this.callbacks.playSound("lakam_409"))
      .onFrame(30, () => {
        this.callbacks.playSound("lakam_409");
        this.signalHit();
      });

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
