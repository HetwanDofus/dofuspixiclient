/**
 * Spell 211 - Craquettes
 *
 * A beam spell that fires from caster to target with an impact effect.
 *
 * Components:
 * - sprite_21: Beam effect (stretched based on distance)
 * - sprite_22: Main projectile at caster position, rotated toward target
 * - sprite_28: Impact effect at target position
 *
 * Original AS timing:
 * - Frame 2: Stop main timeline
 * - Frame 37 (sprite_28): Signal hit (this.end()) and play sound
 * - Frame 67 (sprite_21): Beam stops
 * - Frame 112 (sprite_28): Animation complete
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const BEAM_MANIFEST: SpriteManifest = {
  width: 2368.8,
  height: 572.0999999999999,
  offsetX: -56.099999999999994,
  offsetY: -322.79999999999995,
};

const PROJECTILE_MANIFEST: SpriteManifest = {
  width: 1349.4,
  height: 572.0999999999999,
  offsetX: 10.5,
  offsetY: -323.70000000000005,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 354,
  height: 298.5,
  offsetX: -164.10000000000002,
  offsetY: -145.5,
};

export class Spell211 extends BaseSpell {
  readonly spellId = 211;

  private beamAnim!: FrameAnimatedSprite;
  private projectileAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Calculate distance for beam scaling
    const dx = init.targetX;
    const dy = init.targetY - init.casterY;
    const d = Math.sqrt(dx * dx + dy * dy);

    // Beam animation (sprite_21)
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_21'),
      ...calculateAnchor(BEAM_MANIFEST),
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(0, init.casterY);
    this.beamAnim.sprite.rotation = init.angleRad;
    // AS: _width = _parent.d / 4.5
    this.beamAnim.sprite.scale.x = (d / 4.5) / BEAM_MANIFEST.width * init.scale;
    this.beamAnim.stopAt(66);
    this.container.addChild(this.beamAnim.sprite);

    // Projectile animation (sprite_22)
    this.projectileAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_22'),
      ...calculateAnchor(PROJECTILE_MANIFEST),
      scale: init.scale,
    }));
    this.projectileAnim.sprite.position.set(0, init.casterY);
    this.projectileAnim.sprite.rotation = init.angleRad;
    this.container.addChild(this.projectileAnim.sprite);

    // Impact animation (sprite_28) at target
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_28'),
      ...calculateAnchor(IMPACT_MANIFEST),
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim
      .onFrame(36, () => {
        this.signalHit();
        this.callbacks.playSound('crockette_211');
      });
    this.container.addChild(this.impactAnim.sprite);
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