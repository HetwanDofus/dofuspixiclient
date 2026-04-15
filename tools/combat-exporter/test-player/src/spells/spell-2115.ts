/**
 * Spell 2115 - Carapace (Bouclier)
 *
 * A shield spell animation played at the target position.
 *
 * Components:
 * - anim1 (129 frames): Main animation at target position, stops at frame 128 (0-indexed)
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_17): Play sound 'shield_cara'
 * - Frame 127 (DefineSprite_17): removeMovieClip() - animation ends
 * - Frame 1 (DefineSprite_13): _rotation = random(360) - random rotation
 * - Frame 28 (DefineSprite_13): stop()
 * - Frame 1 (DefineSprite_14): onClipEvent(enterFrame) _rotation += 10 per frame (rotating element)
 * - Frame 55 (DefineSprite_15): stop()
 *
 * The composite animation (anim1) encapsulates all sub-sprite behavior.
 * Hit is signaled at frame 0 (start), completion when animation ends at frame 126 (0-indexed).
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell2115 extends BaseSpell {
  readonly spellId = 2115;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    anim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): play sound and signal hit
    anim.onFrame(0, () => {
      this.callbacks.playSound('shield_cara');
      this.signalHit();
    });

    // Frame 126 (AS frame 127): removeMovieClip - animation ends
    anim.onFrame(126, () => {
      this.complete();
    });

    anim.addTo(this.container);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}
