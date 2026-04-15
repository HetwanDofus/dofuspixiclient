/**
 * Spell 812 - Vlad (Duplicate)
 *
 * A self-targeting spell that plays a single composite animation at the caster position.
 *
 * Components:
 * - duplicate: 126-frame composite animation at caster position with random scale/rotation
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_20_duplicate): Play sound 'vlad_812'
 * - Frame 1 (DefineSprite_20_duplicate): Apply random scale (50-109%) and rotation (-10 to +19 deg)
 * - Frame 124 (DefineSprite_20_duplicate): removeMovieClip() - animation ends
 *
 * Note: DefineSprite_11 does gotoAndStop(random(6)+1) - random start frame for a sub-sprite
 * DefineSprite_5 stops at frame 55, DefineSprite_12 stops at frame 85, DefineSprite_13 stops at 124.
 * The composite export already bakes these into the frames, so we just play 'duplicate' to frame 123.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const DUPLICATE_MANIFEST: SpriteManifest = {
  width: 59.25,
  height: 159.2,
  offsetX: -23,
  offsetY: -95.75,
};

export class Spell812 extends BaseSpell {
  readonly spellId = 812;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(DUPLICATE_MANIFEST);

    const anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('duplicate'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Position at caster
    anim.sprite.position.set(0, init.casterY);

    // AS frame_1/DoAction_2: random scale and rotation
    // this._xscale = 50 + random(60) -> 50 to 109
    const xscale = 50 + Math.floor(Math.random() * 60);
    // this._yscale = this._xscale
    const yscale = xscale;
    // this._rotation = -10 + random(30) -> -10 to +19
    const rotation = -10 + Math.floor(Math.random() * 30);

    // In AS _xscale/_yscale are percentages; combined with init.scale
    anim.sprite.scale.set(
      (xscale / 100) * init.scale,
      (yscale / 100) * init.scale,
    );
    anim.sprite.rotation = (rotation * Math.PI) / 180;

    // Frame 0 (AS frame 1): play sound
    anim.onFrame(0, () => this.callbacks.playSound('vlad_812'));

    // Frame 123 (AS frame 124): removeMovieClip -> stop and complete
    anim.stopAt(123);

    this.container.addChild(anim.sprite);

    // Hit is signaled immediately (self-buff spell - no target impact)
    anim.onFrame(0, () => this.signalHit());
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
