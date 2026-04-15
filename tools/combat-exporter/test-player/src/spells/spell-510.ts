/**
 * Spell 510 - Lance
 *
 * A projectile spell with a single animated sprite.
 *
 * Components:
 * - anim1: Main animation at caster position, rotated toward target
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_9): Play sound 'lance'
 * - Frame 73 (DefineSprite_9): removeMovieClip() - animation ends
 *
 * Note: DefineSprite_6 has a flickering sub-sprite (random visibility each frame)
 * and DefineSprite_8 has sub-sprites with random start frames. These are baked
 * into the composite anim1 frames extracted from the SWF.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 421.35,
  height: 23.15,
  offsetX: -20.9,
  offsetY: -14.3,
};

export class Spell510 extends BaseSpell {
  readonly spellId = 510;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anim1 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      ...calculateAnchor(ANIM1_MANIFEST),
      scale: init.scale,
    }));

    anim1.sprite.position.set(0, init.casterY);
    anim1.sprite.rotation = init.angleRad;

    // Frame 1 (AS) = frame 0 (0-indexed): play sound
    anim1.onFrame(0, () => this.callbacks.playSound('lance'));

    // Frame 73 (AS) = frame 72 (0-indexed): removeMovieClip -> complete
    // Signal hit just before removal
    anim1.onFrame(72, () => {
      this.signalHit();
      this.complete();
    });

    anim1.addTo(this.container);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.signalHit();
      this.complete();
    }
  }
}
