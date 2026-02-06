/**
 * Spell 909 - Fulminant
 *
 * A beam spell with particles that travels from caster to target.
 *
 * Components:
 * - Beam (sprite_22): At caster position, rotated toward target
 * - Impact (sprite_41): At target position
 * - Particles (cercle): Spawned from beam at frame 7
 *
 * Original AS timing:
 * - Frame 7: Spawn particles (nb = 10 + level * 3)
 * - Frame 13: Signal hit (this.end())
 * - Frame 43: Beam stops
 * - Frame 84: Impact animation ends
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const BEAM_MANIFEST: SpriteManifest = {
  width: 1575.3,
  height: 186.3,
  offsetX: -391.2,
  offsetY: -107.7,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 1347.6,
  height: 529.5,
  offsetX: -359.1,
  offsetY: -283.8,
};

export class Spell909 extends BaseSpell {
  readonly spellId = 909;

  private beamAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;
  private level = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Beam animation at caster
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_22'),
      ...calculateAnchor(BEAM_MANIFEST),
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(0, init.casterY);
    this.beamAnim.sprite.rotation = init.angleRad;
    this.beamAnim
      .stopAt(42)
      .onFrame(1, () => this.callbacks.playSound('jet_903'))
      .onFrame(6, () => this.spawnParticles());
    this.container.addChild(this.beamAnim.sprite);

    // Particle system
    this.particles = new ASParticleSystem(textures.getFrames('lib_cercle')[0] ?? Texture.EMPTY);
    this.particles.container.position.set(0, init.casterY);
    this.particles.container.rotation = init.angleRad;
    this.container.addChildAt(this.particles.container, 0);

    // Impact animation at target
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_41'),
      ...calculateAnchor(IMPACT_MANIFEST),
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim.sprite.rotation = init.angleRad;
    this.impactAnim.onFrame(12, () => this.signalHit());
    this.container.addChild(this.impactAnim.sprite);
  }

  private spawnParticles(): void {
    const count = 10 + this.level * 3;
    const d = 120 + (this.level - 1) * 32;

    this.particles.spawnMany(count, () => {
      const accX = 0.8 + 0.12 * Math.random();
      const x = d * Math.random();
      const sr = Math.random() < 0.5 ? -1 : 1;
      const y = sr === -1 ? 5 : -5;
      const vr = (20 + 40 * Math.random()) * sr;
      const vt = (1 + Math.floor(Math.random() * 2)) * ((d - x) / d);
      const vx = 5 + 10 * Math.random();

      return { x, y, vx, accX, vr, vrDecay: 0.97, t: 5, vt, vtDecay: 0.1 };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    if (this.impactAnim.isComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
