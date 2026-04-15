/**
 * Spell 907 - Obscurité (Sacrieur)
 *
 * A composite animation with rising/floating particles at the target position.
 *
 * Components:
 * - anim1 (sprite_15): Main composite animation at target position, 246 frames,
 *   stops at frame 243 (0-indexed: 242 = stopFrame from manifest index 243)
 *
 * The animation is a composite (isComposite: true) that includes:
 * - DefineSprite_10: Spinning/pulsing sprites with random rotation, alpha, and
 *   sinusoidal xscale (i += 0.067 per frame)
 * - DefineSprite_3: Bouncing particles with gravity (v += 0.6, bounce at Y=0)
 * - DefineSprite_13: Two child sprites using sin/cos xscale oscillation
 * - DefineSprite_14: Spiraling rising particles that fade in/out and remove themselves
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'many_504'
 * - Frame 244 (DefineSprite_15): _parent.removeMovieClip(); stop() → animation ends
 *
 * Since this is a composite animation (all behavior is baked into the SVG frames),
 * we play the single anim1 sprite sequence. The composite baking handles all
 * particle/sprite child behaviors.
 *
 * Hit signal: at frame 0 (instant spell, hits immediately)
 * Completion: when anim1 reaches stop frame (frame 243, 0-indexed: 242)
 *   OR frame 244 triggers removeMovieClip (frame index 243 in 0-indexed)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 43.75,
  height: 22.45,
  offsetX: -22.6,
  offsetY: -11,
};

export class Spell907 extends BaseSpell {
  readonly spellId = 907;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Main composite animation at target position
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 in AS (0-indexed: 0): play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('many_504'));

    // Signal hit immediately (instant/area spell)
    this.mainAnim.onFrame(0, () => this.signalHit());

    // Frame 244 in AS (0-indexed: 243): removeMovieClip / stop
    // stopFrame from manifest is 243 (0-indexed)
    this.mainAnim.stopAt(243);

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
