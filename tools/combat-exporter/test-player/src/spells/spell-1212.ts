/**
 * Spell 1212 - Panda Souillure
 *
 * A particle effect spell with multiple animated sprites that fade out.
 *
 * Components:
 * - anim1: Main composite animation (186 frames, stops at 177)
 *
 * Original AS timing:
 * - Frame 1: Play sound "panda_souillure"
 * - Frame 118-178: Fade out phase (alpha decreases by 1.67 per frame)
 * - Frame 178: Complete removal
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

const ANIM1_MANIFEST: SpriteManifest = {
  width: 873,
  height: 966.6,
  offsetX: -363.6,
  offsetY: -848.7,
};

export class Spell1212 extends BaseSpell {
  readonly spellId = 1212;

  private mainAnim!: FrameAnimatedSprite;
  private particles8!: ASParticleSystem;
  private particles15!: ASParticleSystem;
  private particles16!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation
    const anim1Anchor = calculateAnchor(ANIM1_MANIFEST);
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.mainAnim
      .stopAt(176)
      .onFrame(0, () => this.callbacks.playSound('panda_souillure'))
      .onFrame(117, () => this.startFadeOut())
      .onFrame(177, () => this.signalHit());
    this.container.addChild(this.mainAnim.sprite);

    // Particle system for DefineSprite_8 (moving particles)
    const particle8Texture = textures.getFrames('lib_DefineSprite_8')[0] ?? Texture.EMPTY;
    this.particles8 = new ASParticleSystem(particle8Texture);
    this.particles8.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particles8.container);

    // Particle system for DefineSprite_15 (static particles)
    const particle15Texture = textures.getFrames('lib_DefineSprite_15')[0] ?? Texture.EMPTY;
    this.particles15 = new ASParticleSystem(particle15Texture);
    this.particles15.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particles15.container);

    // Particle system for DefineSprite_16 (growing particles)
    const particle16Texture = textures.getFrames('lib_DefineSprite_16')[0] ?? Texture.EMPTY;
    this.particles16 = new ASParticleSystem(particle16Texture);
    this.particles16.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particles16.container);

    // Spawn particles
    this.spawnMovingParticles();
    this.spawnStaticParticles();
    this.spawnGrowingParticles();
  }

  private spawnMovingParticles(): void {
    // DefineSprite_8 particles with movement
    const count = 20; // Estimated from visual complexity
    this.particles8.spawnMany(count, () => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 50 + Math.random() * 150;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const vx = x / 25;
      const vy = y / 25;
      const scale = (50 + Math.floor(Math.random() * 50)) / 100;
      const alpha = (70 + Math.floor(Math.random() * 30)) / 100;

      return {
        x: 0,
        y: 0,
        vx,
        vy,
        vxDecay: 0.98,
        vyDecay: 0.98,
        scale,
        alpha,
        life: 120,
      };
    });
  }

  private spawnStaticParticles(): void {
    // DefineSprite_15 particles (static)
    const count = 15; // Estimated from visual complexity
    this.particles15.spawnMany(count, () => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 30 + Math.random() * 100;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const alpha = (30 + Math.floor(Math.random() * 40)) / 100;
      const rotation = Math.floor(Math.random() * 360) * Math.PI / 180;
      const scale = (20 + Math.floor(Math.random() * 60)) / 100;

      return {
        x,
        y,
        alpha,
        rotation,
        scale,
        life: 19, // Stops at frame 19
      };
    });
  }

  private spawnGrowingParticles(): void {
    // DefineSprite_16 particles (growing)
    const count = 10; // Estimated from visual complexity
    this.particles16.spawnMany(count, () => {
      const angle = Math.random() * Math.PI * 2;
      const distance = 20 + Math.random() * 80;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance;
      const alpha = (30 + Math.floor(Math.random() * 40)) / 100;
      const rotation = Math.floor(Math.random() * 360) * Math.PI / 180;
      const t = 30 + Math.floor(Math.random() * 80);
      const vt = 1;

      return {
        x,
        y,
        alpha,
        rotation,
        t: t / 100, // Convert to scale
        vt: vt / 100,
        vtDecay: 0.98,
        life: 120,
      };
    });
  }

  private startFadeOut(): void {
    // Start fading at frame 118
    // Alpha decreases by 1.67 per frame (at 30fps)
    // Since we're at 60fps, we need to halve the rate
    const fadeRate = 1.67 / 2 / 100; // Convert to 0-1 range and adjust for 60fps
    this.mainAnim.sprite.alpha -= fadeRate;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles8.update();
    this.particles15.update();
    this.particles16.update();

    // Continue fading if we're past frame 117
    if (this.mainAnim.getFrame() >= 117 && this.mainAnim.getFrame() < 177) {
      const fadeRate = 1.67 / 2 / 100; // Adjusted for 60fps
      this.mainAnim.sprite.alpha = Math.max(0, this.mainAnim.sprite.alpha - fadeRate);

      // Apply same fade to particles
      this.particles8.container.alpha = this.mainAnim.sprite.alpha;
      this.particles15.container.alpha = this.mainAnim.sprite.alpha;
      this.particles16.container.alpha = this.mainAnim.sprite.alpha;
    }

    // Check completion
    if (this.mainAnim.getFrame() >= 177) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles8.destroy();
    this.particles15.destroy();
    this.particles16.destroy();
    super.destroy();
  }
}