/**
 * Spell 2046 - Unknown Spell
 *
 * A projectile spell with smoke trail and swirling circle particles.
 *
 * Components:
 * - Smoke (fumee): Main smoke animation at caster position
 * - Circles (cercle): 5 rotating particles spawned at frame 7
 *
 * Original AS timing:
 * - Frame 1: Play sounds "jet_903" and "vol"
 * - Frame 7: Spawn 5 circle particles
 * - Frame 67: Signal hit (this.end())
 * - Frame 139: Complete animation
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

const SMOKE_MANIFEST: SpriteManifest = {
  width: 194.1,
  height: 198,
  offsetX: -86.1,
  offsetY: -111.9,
};

export class Spell2046 extends BaseSpell {
  readonly spellId = 2046;

  private smokeAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;
  private level = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Smoke animation at caster
    this.smokeAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('fumee'),
      ...calculateAnchor(SMOKE_MANIFEST),
      scale: init.scale,
    }));
    this.smokeAnim.sprite.position.set(0, init.casterY);
    this.smokeAnim.sprite.rotation = init.angleRad;
    this.smokeAnim
      .stopAt(138)
      .onFrame(0, () => {
        this.callbacks.playSound('jet_903');
        this.callbacks.playSound('vol');
      })
      .onFrame(6, () => this.spawnParticles())
      .onFrame(66, () => this.signalHit());
    this.container.addChild(this.smokeAnim.sprite);

    // Particle system for circles
    this.particles = new ASParticleSystem(textures.getFrames('lib_cercle')[0] ?? Texture.EMPTY);
    this.particles.container.position.set(0, init.casterY);
    this.particles.container.rotation = init.angleRad;
    this.container.addChildAt(this.particles.container, 0);
  }

  private spawnParticles(): void {
    const count = 5;
    const d = 120 + (this.level - 1) * 32;

    this.particles.spawnMany(count, () => {
      const accx = 0.8 + 0.12 * Math.random();
      const x = d * Math.random();
      const sr = Math.floor(Math.random() * 2) === 1 ? -1 : 1;
      const y = sr === -1 ? 5 : -5;
      const vr = (20 + 40 * Math.random()) * sr;
      const vt = (0.3 + Math.floor(Math.random() * 1)) * ((d - x) / d);
      const vx = 5 + 10 * Math.random();

      return { x, y, vx, accX: accx, vr, vrDecay: 0.97, t: 5, vt, vtDecay: 0.03 };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    if (this.anims.allComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}