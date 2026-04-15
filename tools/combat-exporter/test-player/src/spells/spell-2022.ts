/**
 * Spell 2022 - Flamme
 *
 * A fire spell animation that plays from the caster position rotated toward target.
 *
 * Components:
 * - shoot (DefineSprite_16_shoot): At caster position, rotated toward target, stops at frame 69
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_29): Play sound 'flamme_2022'
 * - Frame 1 (DefineSprite_29): Position at cellFrom, rotate to angle
 * - Frame 13 (DefineSprite_29): Signal hit (this.end())
 * - Frame 70 (DefineSprite_16_shoot): stop()
 * - Frame 67 (DefineSprite_29): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 167.15,
  height: 112.65,
  offsetX: -34.3,
  offsetY: -62,
};

export class Spell2022 extends BaseSpell {
  readonly spellId = 2022;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    const shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    shootAnim.sprite.position.set(0, init.casterY);
    shootAnim.sprite.rotation = init.angleRad;

    shootAnim
      .stopAt(69)
      .onFrame(0, () => this.callbacks.playSound('flamme_2022'))
      .onFrame(12, () => this.signalHit());

    this.container.addChild(shootAnim.sprite);
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
