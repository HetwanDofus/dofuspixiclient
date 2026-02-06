/**
 * Spell 207 - Crokette
 *
 * A projectile spell that shoots a feathery object with smoke trail from caster to target.
 *
 * Components:
 * - shoot: Main projectile animation with embedded feather burst
 * - fumee: Smoke particles spawned along projectile path
 * - plumes: Feather particles spawned at start (via attachMovie)
 *
 * Original AS timing:
 * - Frame 1: Play sound, initialize projectile
 * - Frame 1-289: Projectile travels with oscillating scale
 * - Continuous: Spawn smoke particles along path
 * - Frame 39: Feather burst animation stops
 * - Frame 289: Main animation ends
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
  width: 557.4,
  height: 557.4,
  offsetX: -261,
  offsetY: -445.2,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 120.9,
  height: 106.8,
  offsetX: -64.2,
  offsetY: -52.8,
};

export class Spell207 extends BaseSpell {
  readonly spellId = 207;

  private shootAnim!: FrameAnimatedSprite;
  private featherParticles!: ASParticleSystem;
  private smokeParticles: FrameAnimatedSprite[] = [];
  private level = 1;
  
  // Movement tracking from DefineSprite_15_move
  private xi = 0;
  private yi = 0;
  private moveX = 0;
  private moveY = 0;
  private particleCounter = 0;
  
  // Oscillation variables from PlaceObject2_14_8
  private i = 0;
  private a = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Main shoot animation at caster
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;
    
    // Play sound at frame 1 (index 0)
    this.shootAnim.onFrame(0, () => this.callbacks.playSound('crockette_207'));
    
    // Initialize movement tracking
    this.xi = 0;
    this.yi = 0;
    
    this.container.addChild(this.shootAnim.sprite);

    // Feather particle system
    const featherTexture = textures.getFrames('lib_plumes')[0] ?? Texture.EMPTY;
    this.featherParticles = new ASParticleSystem(featherTexture);
    this.featherParticles.container.position.set(0, init.casterY);
    this.featherParticles.container.rotation = init.angleRad;
    this.container.addChildAt(this.featherParticles.container, 0);
    
    // Spawn initial feathers (DefineSprite_2 frame 1 logic)
    this.spawnInitialFeathers();
  }

  private spawnInitialFeathers(): void {
    // From DefineSprite_2: Create 10 feather particles
    this.featherParticles.spawnMany(10, () => {
      // From DefineSprite_6_plumes onClipEvent(load)
      const t = 30 + Math.floor(Math.random() * 30); // Scale: 30-60
      const duree = 60 + Math.floor(Math.random() * 30); // Duration: 60-90 frames
      const vy = -3 - 10 * Math.random(); // Upward velocity: -3 to -13
      const vx = -10 + 20 * Math.random(); // Horizontal velocity: -10 to +10
      const vch = 0.1 + 0.1 * Math.random(); // Gravity: 0.1 to 0.2
      const vr = 0.1 + 0.1 * Math.random(); // Rotation speed: 0.1 to 0.2
      const amp = 30 + Math.floor(Math.random() * 70); // Rotation amplitude: 30-100
      
      // From DefineSprite_2: Initial velocities
      const initialVx = 40 * (Math.random() - 0.5); // -20 to +20
      const initialVy = 40 * (Math.random() - 0.5); // -20 to +20
      
      return {
        x: 0,
        y: 0,
        vx: initialVx + vx,
        vy: initialVy + vy,
        scale: t / 100, // Convert to 0-1 scale
        rotation: 0,
        alpha: 1,
        custom: {
          duree,
          vch,
          vr,
          amp,
          a: 0,
          age: 0,
        },
      };
    });
  }

  private spawnSmokeParticle(): void {
    const smokeTextures = this.container.parent?.parent?.parent?.children[0]?.['textures']?.getFrames('fumee');
    if (!smokeTextures || smokeTextures.length === 0) {
      return;
    }

    const fumeeAnchor = calculateAnchor(FUMEE_MANIFEST);
    const smoke = new FrameAnimatedSprite({
      textures: smokeTextures,
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      scale: 1 / 6,
    });

    // From DefineSprite_15_move onEnterFrame
    smoke.sprite.position.set(this.moveX, this.moveY + 60); // Y_OFFSET
    smoke.sprite.rotation = Math.random() * Math.PI * 2; // random(360) in radians

    // From DefineSprite_19_fumee frame 13
    smoke.onFrame(12, () => {
      const randomJump = Math.floor(Math.random() * 21); // random(21)
      smoke.gotoFrame(Math.min(smoke.getFrame() + randomJump, smoke.textures.length - 1));
    });
    
    // Auto-remove at end (frame 64)
    smoke.onFrame(63, () => {
      const index = this.smokeParticles.indexOf(smoke);
      if (index !== -1) {
        this.smokeParticles.splice(index, 1);
      }
      smoke.destroy();
    });
    
    this.smokeParticles.push(smoke);
    this.container.addChildAt(smoke.sprite, 0);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);
    
    // Update smoke particles
    for (const smoke of this.smokeParticles) {
      smoke.update(deltaTime);
    }
    
    // Update feather particles with custom physics
    this.featherParticles.updateCustom((particle) => {
      const custom = particle.custom;
      custom.age++;
      
      // From DefineSprite_6_plumes onClipEvent(enterFrame)
      if (custom.age > custom.duree) {
        particle.alpha -= 0.03; // 3% per frame
      }
      
      if (particle.y < 0) {
        // Apply gravity
        particle.vy += custom.vch;
        particle.y += particle.vy;
        particle.x += particle.vx;
        
        // Damping
        particle.vy *= 0.9;
        particle.vx *= 0.9;
        
        // Amplitude decay
        custom.amp *= 0.98;
        
        // Oscillating rotation
        custom.a += custom.vr;
        particle.rotation = (custom.amp * Math.cos(custom.a) * Math.PI) / 180;
      }
      
      return particle.alpha > 0;
    });
    
    // Movement simulation for smoke spawning
    if (!this.shootAnim.isStopped() && this.shootAnim.getFrame() < 289) {
      // Simulate projectile movement
      const progress = this.shootAnim.getFrame() / 289;
      const targetX = this.container.parent?.parent?.parent?.children[0]?.['init']?.targetX ?? 0;
      const targetY = this.container.parent?.parent?.parent?.children[0]?.['init']?.targetY ?? 60;
      
      const newX = targetX * progress;
      const newY = targetY * progress;
      
      // From DefineSprite_15_move: Spawn smoke particle
      if (this.particleCounter % 2 === 0) { // Spawn every other frame for performance
        // Calculate velocity based on movement delta
        const vx = newX - this.xi + 20 * (Math.random() - 0.5); // -10 to +10
        const vy = newY - this.yi + 20 * (Math.random() - 0.5); // -10 to +10
        
        this.moveX = newX;
        this.moveY = newY;
        this.spawnSmokeParticle();
      }
      
      this.xi = newX;
      this.yi = newY;
      this.particleCounter++;
      
      // Oscillating scale from PlaceObject2_14_8
      this.i += Math.sin(this.a += 0.02);
      this.shootAnim.sprite.scale.y = this.shootAnim.sprite.scale.x * Math.sin(this.i);
    }
    
    // Signal hit at appropriate time (estimated around 2/3 through)
    if (this.shootAnim.getFrame() === 193) {
      this.signalHit();
    }

    // Check completion
    if (this.shootAnim.getFrame() >= 289 &&
        !this.featherParticles.hasAliveParticles() &&
        this.smokeParticles.every(smoke => smoke.isComplete())) {
      this.complete();
    }
  }

  destroy(): void {
    this.featherParticles.destroy();
    for (const smoke of this.smokeParticles) {
      smoke.destroy();
    }
    this.smokeParticles = [];
    super.destroy();
  }
}