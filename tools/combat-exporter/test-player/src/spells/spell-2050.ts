/**
 * Spell 2050 - Aspiration
 *
 * A beam spell that travels from caster to target with composite animation.
 * The main animation (anim1) plays at target position, rotated toward caster.
 *
 * Components:
 * - anim1 (DefineSprite_12): Main beam at target position, stops at frame 63
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'aspiration'
 * - Frame 48 (DefineSprite_11): stop() - particle child stops
 * - Frame 64 (DefineSprite_12): stop() + removeMovieClip() - animation ends
 *
 * DefineSprite_11 behavior (particle-like child within anim1):
 * - On load: _Y = 20 * (-0.5 + Math.random()); if(random(4)==1) _yscale = -_yscale
 * - Stops at frame 48
 * The composite SVG frames already bake in the per-frame appearance,
 * so we just play anim1 and stop at frame 63 (0-indexed for AS frame 64).
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 489.85,
  height: 32.75,
  offsetX: -4.4,
  offsetY: -15.5,
};

export class Spell2050 extends BaseSpell {
  readonly spellId = 2050;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    void context;

    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Main animation at target position, rotated toward caster (back-angle = angleRad + PI)
    // The beam travels from caster to target, so position at target and rotate back
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Position at target, rotated to face back toward caster
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    // The beam origin (offsetX near 0) is at target, extends toward caster
    // Rotate 180 degrees from the caster->target angle to point back
    this.mainAnim.sprite.rotation = init.angleRad + Math.PI;

    // Frame 0 (AS frame 1): play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('aspiration'));

    // Frame 63 (AS frame 64): stop() + removeMovieClip() -> completion
    this.mainAnim
      .stopAt(63)
      .onFrame(63, () => {
        this.signalHit();
      });

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
