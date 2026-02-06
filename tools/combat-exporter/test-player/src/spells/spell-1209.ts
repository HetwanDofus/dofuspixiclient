/**
 * Spell 1209 - Unknown
 *
 * A particle burst spell that creates multiple sprites with random spiraling trajectories.
 * Particles gradually slow down and shrink over 115 frames.
 *
 * Components:
 * - sprite_6: Particle sprites with dynamic movement
 * - sprite_7: Cleanup animation (115 frames)
 *
 * Original AS timing:
 * - Frame 1: Particles start moving with random angles and velocities
 * - Frame 115: Cleanup via removeMovieClip
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const PARTICLE_MANIFEST: SpriteManifest = {
  width: 247.5,
  height: 60,
  offsetX: -120,
  offsetY: -30,
};

const CLEANUP_MANIFEST: SpriteManifest = {
  width: 1127.4,
  height: 1127.4,
  offsetX: -574.2,
  offsetY: -658.2,
};

interface Particle {
  sprite: FrameAnimatedSprite;
  angle: number;
  v: number;
  va: number;
  t: number;
  x: number;
  y: number;
}

export class Spell1209 extends BaseSpell {
  readonly spellId = 1209;

  private cleanupAnim!: FrameAnimatedSprite;
  private particles: Particle[] = [];
  private particleCount = 10; // Default particle count

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Calculate particle count based on context (if needed)
    // This could be based on level or other factors
    this.particleCount = 10;

    // Create cleanup animation (sprite_7)
    this.cleanupAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_7'),
      ...calculateAnchor(CLEANUP_MANIFEST),
      scale: init.scale,
    }));
    this.cleanupAnim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.cleanupAnim.sprite);

    // Create particle sprites
    for (let i = 0; i < this.particleCount; i++) {
      const particleAnim = new FrameAnimatedSprite({
        textures: textures.getFrames('sprite_6'),
        ...calculateAnchor(PARTICLE_MANIFEST),
        scale: init.scale,
      });
      particleAnim.stopAt(0); // Stop at frame 1 (index 0)
      
      // Initialize particle physics based on AS code
      const particle: Particle = {
        sprite: particleAnim,
        angle: 360 * Math.random(),
        v: 6.67 + Math.floor(Math.random() * 20),
        va: 40 * (-0.5 + Math.random()),
        t: 100,
        x: init.targetX,
        y: init.targetY,
      };

      // Set initial scale based on velocity
      particleAnim.sprite.scale.x = (particle.v * 14) / 100 * init.scale;
      particleAnim.sprite.scale.y = (particle.v * 14) / 100 * init.scale;
      particleAnim.sprite.position.set(particle.x, particle.y);
      
      this.particles.push(particle);
      this.container.addChild(particleAnim.sprite);
    }

    // Signal hit can be called at a specific frame if needed
    // For now, we'll signal hit immediately as there's no specific timing in AS
    this.signalHit();
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update cleanup animation
    this.anims.update(deltaTime);

    // Update particle physics
    for (const particle of this.particles) {
      // 50% chance to change angular velocity each frame
      if (Math.random() < 0.5) {
        particle.va = 40 * (-0.5 + Math.random());
      }

      // Update angle
      particle.angle += particle.va;

      // Update scale based on velocity
      particle.sprite.sprite.scale.x = (particle.v * 14) / 100 * (1 / 6);
      particle.sprite.sprite.scale.y = (particle.v * 14) / 100 * (1 / 6);

      // Calculate movement
      const radians = (particle.angle * Math.PI) / 180;
      const dx = particle.v * Math.cos(radians);
      const dy = particle.v * Math.sin(radians);

      // Update position
      particle.x += dx;
      particle.y += dy;
      particle.sprite.sprite.position.set(particle.x, particle.y);

      // Set rotation to match movement angle
      particle.sprite.sprite.rotation = radians;

      // Decay velocity and timer
      particle.v *= 0.9;
      particle.t *= 0.95;

      // Update particle animation
      particle.sprite.update(deltaTime);
    }

    // Check if cleanup animation is complete
    if (this.cleanupAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    for (const particle of this.particles) {
      particle.sprite.destroy();
    }
    this.particles = [];
    super.destroy();
  }
}