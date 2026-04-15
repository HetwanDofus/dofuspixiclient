/**
 * Spell 805 - Vlad (Duplicate)
 *
 * A self-targeting spell that plays a single animation at the caster position.
 *
 * Components:
 * - duplicate: Main animation at caster position, scaled by level
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'vlad_805'
 * - Frame 1 (DefineSprite_8_duplicate): Set scale = 40 + 20 * level
 * - Frame 85 (DefineSprite_8_duplicate): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const DUPLICATE_MANIFEST: SpriteManifest = {
  width: 104.15,
  height: 109.5,
  offsetX: -46.85,
  offsetY: -82.4,
};

export class Spell805 extends BaseSpell {
  readonly spellId = 805;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const level = Math.max(1, Math.min(6, context?.level ?? 1));

    // AS: t = 40 + 20 * this._parent.level; _xscale = t; _yscale = t;
    const asScale = (40 + 20 * level) / 100;

    const anchor = calculateAnchor(DUPLICATE_MANIFEST);

    const anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('duplicate'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale * asScale,
    }));

    anim.sprite.position.set(0, init.casterY);

    // Frame 0 (AS frame 1): play sound
    anim.onFrame(0, () => this.callbacks.playSound('vlad_805'));

    // Frame 84 (AS frame 85): removeMovieClip - signal hit and end
    anim.onFrame(84, () => {
      this.signalHit();
    });

    this.container.addChild(anim.sprite);
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
