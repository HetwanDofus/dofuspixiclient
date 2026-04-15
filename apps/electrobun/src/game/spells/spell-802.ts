/**
 * Spell 802 - Vlad (Sacrieur)
 *
 * A single composite animation played at the target position.
 * The animation contains internal rotating/flickering sub-elements
 * handled by the composite frames themselves.
 *
 * Components:
 * - anim1: 129-frame composite animation at target position, stops at frame 126
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'vlad_802'
 * - Frame 127 (DefineSprite_10): stop() + removeMovieClip() → animation ends
 * - DefineSprite_10/frame_1: inner sprite rotates +0.66 degrees per frame
 * - DefineSprite_9/frame_61: _rotation = -40 (static rotation in composite)
 * - DefineSprite_7/frame_28: stop() (inner sprite stops at frame 28)
 * - DefineSprite_7/PlaceObject2_6_1 enterFrame: _alpha = 30 + random(120), t=100 scale
 * - DefineSprite_6/PlaceObject2_2_1 enterFrame: _alpha = random(150) - 100
 * - DefineSprite_6/PlaceObject2_4_3 enterFrame: gotoAndStop(random(2) + 1)
 *
 * The internal sub-sprite behavior is baked into the composite SVG frames.
 * Hit is signaled at the start (frame 0) since the spell hits immediately.
 * Completion is at frame 126 (stop frame from manifest).
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
  width: 212.2,
  height: 213.35,
  offsetX: -101.05,
  offsetY: -140.35,
};

export class Spell802 extends BaseSpell {
  readonly spellId = 802;

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

    // Frame 0 (AS frame 1): play sound
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound("vlad_802");
    });

    // Signal hit immediately at the start of the animation
    this.mainAnim.onFrame(0, () => {
      this.signalHit();
    });

    // Stop at frame 126 (AS frame 127 stop() + removeMovieClip())
    this.mainAnim.stopAt(126);

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
