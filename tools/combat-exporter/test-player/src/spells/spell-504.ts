/**
 * Spell 504 - Many (Sadida)
 *
 * A composite spell animation with multiple child effects:
 * - A main animation (anim1) that plays through 246 frames and stops at frame 243
 * - DefineSprite_9: Contains a child (PlaceObject2_8_3) with random scale 80-129%,
 *   and another child (PlaceObject2_6_1) whose alpha tracks parent xscale
 * - DefineSprite_10: Sine-wave xscale oscillation with random rotation/alpha
 * - DefineSprite_3: Gravity bounce physics (v accumulates, bounces at Y=0)
 * - DefineSprite_13: Random alpha flicker (0-169)
 * - DefineSprite_14: Spiral ascent particle with alpha fade-in/fade-out
 *
 * Since all sub-sprite behaviors are baked into the composite anim1 frames,
 * we play the single composite animation and signal hit partway through.
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'many_504'
 * - Frame 244 (DefineSprite_15): stop() + removeMovieClip() -> animation ends
 * - Hit signal: mid-animation (approximated at frame 30, when effects are visible)
 * - The manifest stopFrame is 243 (0-indexed), fadingFrame is 242
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 60.35,
  height: 38,
  offsetX: -22.6,
  offsetY: -25.15,
};

export class Spell504 extends BaseSpell {
  readonly spellId = 504;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      stopFrame: 243,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): play sound
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound('many_504');
    });

    // Signal hit when the main impact visuals are clearly playing
    // The composite animation contains the full effect; signal hit early in the animation
    this.mainAnim.onFrame(29, () => {
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
