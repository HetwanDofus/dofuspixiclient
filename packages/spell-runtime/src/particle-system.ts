/**
 * Particle System - ActionScript-style physics for spell effects
 *
 * This particle system is designed to replicate the exact physics behavior
 * from Dofus 1.29 ActionScript spell effects.
 *
 * Key AS patterns replicated:
 * - Velocity with friction: vx *= friction
 * - Scale as percentage (t): t += vt; _xscale = t; _yscale = t;
 * - Rotation velocity decay: _rotation -= (vr *= 0.97)
 * - Death when scale < 0: if (t < 0) removeMovieClip()
 */

import { Container, Sprite, Texture } from 'pixi.js';

/**
 * Particle physics configuration
 * Based on common AS2 onClipEvent(load) patterns
 */
export interface ASParticleConfig {
  /** Initial X position */
  x: number;
  /** Initial Y position */
  y: number;
  /** X velocity (pixels per frame) */
  vx?: number;
  /** Y velocity (pixels per frame) */
  vy?: number;
  /** X velocity multiplier per frame (friction/acceleration) */
  accX?: number;
  /** Y velocity multiplier per frame */
  accY?: number;
  /** Rotation velocity (degrees per frame, can be negative) */
  vr?: number;
  /** Rotation velocity decay multiplier (e.g., 0.97) */
  vrDecay?: number;
  /** Initial scale as percentage (e.g., 5 = 5%) */
  t?: number;
  /** Scale velocity (change per frame) */
  vt?: number;
  /** Scale velocity decay (subtracted from vt each frame) */
  vtDecay?: number;
  /** Initial rotation in degrees */
  rotation?: number;
  /** Initial alpha (0-1) */
  alpha?: number;
  /** Alpha change per frame */
  alphaVelocity?: number;
  /** Gravity (added to vy each frame) */
  gravity?: number;
}

/**
 * Active particle instance with physics state
 */
export interface ASParticle {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  accX: number;
  accY: number;
  vr: number;
  vrDecay: number;
  t: number;
  vt: number;
  vtDecay: number;
  rotation: number;
  alpha: number;
  alphaVelocity: number;
  gravity: number;
  alive: boolean;
}

/**
 * ActionScript-style particle system
 *
 * Replicates the exact physics from Dofus 1.29 spell effects.
 */
export class ASParticleSystem {
  readonly container: Container;
  private particles: ASParticle[] = [];
  private texture: Texture;

  constructor(texture: Texture) {
    this.container = new Container();
    this.texture = texture;
  }

  /**
   * Set the texture for new particles
   */
  setTexture(texture: Texture): this {
    this.texture = texture;
    return this;
  }

  /**
   * Spawn a particle with AS-style configuration
   */
  spawn(config: ASParticleConfig): ASParticle {
    const sprite = new Sprite(this.texture);
    sprite.anchor.set(0.5);

    const particle: ASParticle = {
      sprite,
      x: config.x,
      y: config.y,
      vx: config.vx ?? 0,
      vy: config.vy ?? 0,
      accX: config.accX ?? 1,
      accY: config.accY ?? 1,
      vr: config.vr ?? 0,
      vrDecay: config.vrDecay ?? 1,
      t: config.t ?? 100,
      vt: config.vt ?? 0,
      vtDecay: config.vtDecay ?? 0,
      rotation: config.rotation ?? 0,
      alpha: config.alpha ?? 1,
      alphaVelocity: config.alphaVelocity ?? 0,
      gravity: config.gravity ?? 0,
      alive: true,
    };

    // Apply initial state
    sprite.position.set(particle.x, particle.y);
    sprite.rotation = (particle.rotation * Math.PI) / 180;
    sprite.scale.set(Math.max(0, particle.t / 100));
    sprite.alpha = particle.alpha;

    this.particles.push(particle);
    this.container.addChild(sprite);

    return particle;
  }

  /**
   * Spawn multiple particles with a generator function
   */
  spawnMany(count: number, generator: (index: number) => ASParticleConfig): this {
    for (let i = 0; i < count; i++) {
      this.spawn(generator(i));
    }
    return this;
  }

  /**
   * Update all particles with AS-style physics
   *
   * Replicates the onClipEvent(enterFrame) behavior:
   * - _rotation -= (vr *= vrDecay)
   * - _X += (vx *= accX)
   * - _Y += (vy *= accY)
   * - vy += gravity
   * - t += vt; vt -= vtDecay
   * - _xscale = t; _yscale = t
   * - if (t < 0) removeMovieClip()
   */
  update(): void {
    for (const p of this.particles) {
      if (!p.alive) continue;

      // Update rotation: _rotation -= (vr *= decay)
      p.vr *= p.vrDecay;
      p.rotation -= p.vr;

      // Update velocity with acceleration/friction
      p.vx *= p.accX;
      p.vy *= p.accY;

      // Apply gravity
      p.vy += p.gravity;

      // Update position
      p.x += p.vx;
      p.y += p.vy;

      // Update scale: t += vt; vt -= vtDecay
      p.vt -= p.vtDecay;
      p.t += p.vt;

      // Update alpha
      p.alpha += p.alphaVelocity;

      // Apply to sprite
      p.sprite.position.set(p.x, p.y);
      p.sprite.rotation = (p.rotation * Math.PI) / 180;

      // Scale (t is percentage, convert to 0-1)
      const scale = Math.max(0, p.t / 100);
      p.sprite.scale.set(scale);
      p.sprite.alpha = Math.max(0, p.alpha);

      // Death conditions (same as AS: if (t < 0) removeMovieClip())
      if (p.t < 0 || p.alpha <= 0) {
        p.alive = false;
        p.sprite.visible = false;
      }
    }
  }

  /**
   * Check if any particles are still alive
   */
  hasAliveParticles(): boolean {
    return this.particles.some(p => p.alive);
  }

  /**
   * Get count of alive particles
   */
  get aliveCount(): number {
    return this.particles.filter(p => p.alive).length;
  }

  /**
   * Clear all particles
   */
  clear(): void {
    for (const p of this.particles) {
      p.sprite.destroy();
    }
    this.particles = [];
  }

  /**
   * Reset system (clear and prepare for reuse)
   */
  reset(): void {
    this.clear();
  }

  /**
   * Destroy the system
   */
  destroy(): void {
    this.clear();
    this.container.destroy();
  }
}
