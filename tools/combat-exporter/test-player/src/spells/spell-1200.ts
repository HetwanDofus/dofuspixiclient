/**
 * Spell 1200 - Unknown Name
 *
 * An explosion-type spell with particle effects.
 *
 * Components:
 * - Shoot animation: Main explosion effect at caster position
 * - Move animation: Secondary movement effect
 * - Particles: Random explosion debris particles
 *
 * Original AS timing:
 * - Frame 1: Play "explosion" sound
 * - Frame 1-129: Particle physics simulation (DefineSprite_5)
 * - Frame 130: Remove movie clip
 * - Move animation stops at frame 25
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

const SHOOT_MANIFEST: SpriteManifest = {
  width: 701.7,
  height: 344.4,
  offsetX: -335.1,
  offsetY: -175.5,
};

const MOVE_MANIFEST: SpriteManifest = {
  width: 175.5,
  height: 349.5,
  offsetX: -86.1,
  offsetY: -317.70000000000005,
};

export class Spell1200 extends BaseSpell {
  readonly spellId = 1200;

  private shootAnim!: FrameAnimatedSprite;
  private moveAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Shoot animation at caster position
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim
      .stopAt(131)
      .onFrame(0, () => {
        this.callbacks.playSound('explosion');
        this.spawnParticles();
      })
      .onFrame(129, () => this.signalHit());
    this.container.addChild(this.shootAnim.sprite);

    // Move animation
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      ...calculateAnchor(MOVE_MANIFEST),
      scale: init.scale,
    }));
    this.moveAnim.sprite.position.set(0, init.casterY);
    this.moveAnim.stopAt(26);
    this.container.addChild(this.moveAnim.sprite);

    // Particle system - using a placeholder texture since AS doesn't specify which symbol
    const particleTexture = textures.getTexture('particle') || Texture.WHITE;
    this.particles = new ASParticleSystem(particleTexture);
    this.particles.container.position.set(0, init.casterY);
    this.container.addChild(this.particles.container);
  }

  private spawnParticles(): void {
    // Based on DefineSprite_5 particle physics
    const particleCount = 10; // AS doesn't specify count, using reasonable default

    this.particles.spawnMany(particleCount, () => {
      const vi = 4.8;
      const vx = (-0.5 + Math.random()) * vi;
      const vy = (-0.5 + Math.random()) * vi / 2;
      const size = Math.floor(Math.random() * 80) + 40;
      const vs = 10 + 10 * Math.random();
      const va = 0.5 + Math.floor(Math.random() * 3.4);
      const _alpha = 60 + Math.floor(Math.random() * 50);
      const acc = 0.84 + 0.15 * Math.random();

      return {
        x: 0,
        y: 0,
        vx: vx,
        vy: vy,
        scale: size / 100,
        alpha: _alpha / 100,
        alphaDecay: va / 100,
        scaleVelocity: vs / 100,
        scaleDecay: 0.23,
        accX: acc,
        accY: acc,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    // Complete when shoot animation is done (frame 132)
    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}