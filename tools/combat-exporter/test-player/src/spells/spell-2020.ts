/**
 * Spell 2020 - Healing / Guerison
 *
 * A healing spell with spiraling particle effects that rise upward.
 *
 * Components:
 * - anim1 (DefineSprite_10): Main animation at target position, 246 frames, stops at frame 243
 *
 * The main animation contains internal sub-sprites (DefineSprite_3, 7, 8, 9) that
 * are composited into the anim1 frames:
 * - DefineSprite_3: Rising particles with random alpha and upward velocity (vy = -3*random - 2.5)
 * - DefineSprite_7: Rotating element (vr = 6.67 * random)
 * - DefineSprite_8: Scale-oscillating element (_xscale = 100 * sin(i += 0.067))
 * - DefineSprite_9: Spiraling orb that rises and fades (Lissajous-like path)
 *
 * Original AS timing:
 * - Frame 1 (main timeline): Play sound 'many_504'
 * - Frame 1 (DefineSprite_10): Play sound 'guerison'
 * - Frame 244 (DefineSprite_10): removeMovieClip() + stop()
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 46,
  height: 16,
  offsetX: -24.4,
  offsetY: -9.25,
};

export class Spell2020 extends BaseSpell {
  readonly spellId = 2020;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Main animation (DefineSprite_10 / anim1) at target position
    // Frame 244 (0-indexed: 243) is the stop/remove frame
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 of main timeline (0-indexed: 0): Play 'many_504'
    // Frame 1 of DefineSprite_10 (0-indexed: 0): Play 'guerison'
    // Both fire at frame 0 since the composite renders them together
    this.mainAnim
      .onFrame(0, () => {
        this.callbacks.playSound('many_504');
        this.callbacks.playSound('guerison');
      })
      // Signal hit when the animation reaches a meaningful point
      // The spell is a healing effect - signal hit early (frame 0)
      .onFrame(0, () => this.signalHit())
      // Stop at frame 243 (AS frame 244 = 0-indexed 243)
      .stopAt(243);

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
