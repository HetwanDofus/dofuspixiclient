/**
 * Spell 2916
 *
 * A flame/wisp animation with oscillating sprites and upward-drifting particles.
 *
 * Components:
 * - anim1: Composite animation at target position, stops at frame 387
 *
 * The animation is a composite that includes:
 * - DefineSprite_7: Oscillates horizontally using sin wave (vamp = 0.1 * random)
 * - DefineSprite_6: Child of _7, rotates using sin wave with shared vamp
 * - DefineSprite_4: Deeper child, rotates with 15 * sin amplitude
 * - DefineSprite_3: Deepest child, rotates with 20 * sin amplitude
 * - DefineSprite_8: Drifts right+up, fades after t > 330, removed at frame 388
 *
 * Original AS timing:
 * - Frame 13 (main): stop() - but this is the composite animation frame
 * - Frame 388 (DefineSprite_8): removeMovieClip() + stop()
 * - The anim1 manifest stopFrame is 387 (0-indexed)
 *
 * Since anim1 is a composite (pre-rendered), all the internal oscillation/physics
 * are baked into the SVG frames. We just play the animation and stop at frame 387.
 *
 * Hit signal: at frame 0 (instant spell, hits on first frame)
 * Completion: when anim1 stops at frame 387
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
  width: 15.15,
  height: 35.45,
  offsetX: -7,
  offsetY: -53.15,
};

export class Spell2916 extends BaseSpell {
  readonly spellId = 2916;

  private anim1!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.anim1 = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.anim1.sprite.position.set(init.targetX, init.targetY);

    // stopFrame is 387 (0-indexed), matching manifest stopFrame
    this.anim1.stopAt(387).onFrame(0, () => this.signalHit());

    this.container.addChild(this.anim1.sprite);
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
