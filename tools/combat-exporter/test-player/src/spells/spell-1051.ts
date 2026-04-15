/**
 * Spell 1051 - Sacrieur spell
 *
 * A single animated sprite effect at the target position.
 * The sprite has randomized scale and alpha applied each frame (enterFrame).
 *
 * Components:
 * - sprite_6: At target position, stops at frame 38 (AS frame 39)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'sacrieur_1051'
 * - Frame 1 (enterFrame): randomize _alpha, _xscale, _yscale, _rotation each frame
 * - Frame 39 (sprite_6): stop()
 * - Frame 47 (main): removeMovieClip()
 *
 * Note: DefineSprite_7 contains sprite_6 instances with random start frames (random(20))
 * and random scale (20 + random(80)). The main sprite (PlaceObject2_1_1) has per-frame
 * randomized alpha (−20 + random(80)), scale (90−100%), and rotation.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_MANIFEST: SpriteManifest = {
  width: 145.2,
  height: 102,
  offsetX: -7.9,
  offsetY: -51.1,
};

export class Spell1051 extends BaseSpell {
  readonly spellId = 1051;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SPRITE_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_6'),
      fps: 40,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): play sound
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound('sacrieur_1051');
    });

    // Signal hit immediately when the effect starts (frame 0)
    this.mainAnim.onFrame(0, () => {
      this.signalHit();
    });

    // Stop at frame 38 (AS frame 39, 0-indexed = 38)
    this.mainAnim.stopAt(38);

    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Per-frame randomization (AS onClipEvent(enterFrame) on PlaceObject2_1_1):
    // _alpha = -20 + random(80)  → 0-indexed alpha range: -20 to 59 → clamp 0-1
    // t = 10 * Math.random() + 90 → scale 90-100%
    // _rotation = random(360)
    if (!this.mainAnim.isStopped() && !this.mainAnim.isComplete()) {
      const alpha = (-20 + Math.floor(Math.random() * 80)) / 100;
      this.mainAnim.sprite.alpha = Math.max(0, Math.min(1, alpha));

      const t = 10 * Math.random() + 90;
      const baseScale = init_scale_ref(this.mainAnim);
      this.mainAnim.sprite.scale.set(baseScale * (t / 100));

      this.mainAnim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
    }

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
