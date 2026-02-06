/**
 * Spell 1203 - Panda Spell
 *
 * A spell animation with particle effects and a main shoot animation.
 * The main animation fades out starting at frame 39.
 *
 * Components:
 * - shoot: Main animation (74 frames) with fade effect starting at frame 39
 * - sprite_4: Particle effect with scaling decay  
 * - sprite_6: Directional particle effect with rotation
 * - sprite_2: Moving/flickering effect (if used)
 *
 * Original AS timing:
 * - Frame 1: Play sound "m_panda_spell_a"
 * - Frame 4: Reset rotation to 0
 * - Frame 39+: Start fading (alpha -= 3.34 per frame)
 * - Frame 72: Animation stops and removes
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
  width: 691.5,
  height: 387,
  offsetX: -396,
  offsetY: -193.8,
};

export class Spell1203 extends BaseSpell {
  readonly spellId = 1203;

  private shootAnim!: FrameAnimatedSprite;
  private particles4!: ASParticleSystem;
  private particles6!: ASParticleSystem;
  private fadeStartFrame = 38; // Frame 39 in AS (0-indexed)
  private fadePerFrame = 3.34;
  private currentAlpha = 100;
  private isFading = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;
    this.shootAnim
      .stopAt(71) // Frame 72 in AS
      .onFrame(0, () => this.callbacks.playSound('m_panda_spell_a'))
      .onFrame(3, () => { // Frame 4 in AS
        this.shootAnim.sprite.rotation = 0;
      })
      .onFrame(this.fadeStartFrame, () => {
        this.isFading = true;
      })
      .onFrame(35, () => this.signalHit()); // Signal hit midway through animation
    this.container.addChild(this.shootAnim.sprite);

    // Particle system for sprite_4 (scaling particles)
    const particle4Texture = textures.getFrames('sprite_4')[0];
    if (particle4Texture) {
      this.particles4 = new ASParticleSystem(particle4Texture);
      this.particles4.container.position.set(0, init.casterY);
      this.container.addChild(this.particles4.container);
      
      // Spawn particles following DefineSprite_4 behavior
      this.spawnParticles4(init.angleRad);
    }

    // Particle system for sprite_6 (directional particles)
    const particle6Texture = textures.getFrames('sprite_6')[0];
    if (particle6Texture) {
      this.particles6 = new ASParticleSystem(particle6Texture);
      this.particles6.container.position.set(0, init.casterY);
      this.container.addChild(this.particles6.container);
      
      // Spawn particles following DefineSprite_6 behavior
      this.spawnParticles6(init.angleRad);
    }
  }

  private spawnParticles4(parentAngle: number): void {
    // Spawn multiple particles with behavior from DefineSprite_4
    const count = 5; // Reasonable number of particles
    
    this.particles4.spawnMany(count, () => {
      const angle = parentAngle;
      const v = 0.67 + Math.floor(Math.random() * 5);
      const va = 20 * (-0.5 + Math.random());
      const t = 70 + Math.floor(Math.random() * 30);
      
      // Initial position (particles start at origin)
      const x = 0;
      const y = 0;
      
      // Custom update function to replicate exact AS behavior
      const customUpdate = (particle: any, deltaFrames: number) => {
        // Update angular velocity randomly
        if (Math.floor(Math.random() * 3) === 1) {
          particle.va = 20 * (-0.5 + Math.random());
        }
        
        // Update scale
        particle.scale = particle.t;
        particle.t *= 0.975;
        
        // Update angle
        particle.angle += particle.va;
        
        // Calculate velocity components (exact AS formulas)
        const vx = Math.abs(particle.v * Math.cos(particle.angle * 0.017453292519943295));
        const vy = particle.v * Math.sin(particle.angle * 0.017453292519943295);
        
        // Update position
        particle.x += vx * deltaFrames;
        particle.y += vy * deltaFrames;
        
        // Decay velocity
        particle.v *= 0.95;
        
        // Check if particle should die
        if (particle.t < 0.1 || particle.v < 0.01) {
          particle.alive = false;
        }
      };
      
      return { 
        x, 
        y, 
        scale: t / 100, // Convert to normalized scale
        alpha: 1,
        customData: { angle, v, va, t },
        customUpdate
      };
    });
  }

  private spawnParticles6(parentAngle: number): void {
    // Spawn multiple particles with behavior from DefineSprite_6
    const count = 3; // Reasonable number of particles
    
    this.particles6.spawnMany(count, () => {
      const angle = parentAngle;
      const v = 0.67 + Math.floor(Math.random() * 5);
      const va = 20 * (-0.5 + Math.random());
      const t = 100;
      
      // Initial position (particles start at origin)
      const x = 0;
      const y = 0;
      
      // Custom update function to replicate exact AS behavior
      const customUpdate = (particle: any, deltaFrames: number) => {
        // Update angular velocity randomly (less frequent than sprite_4)
        if (Math.floor(Math.random() * 5) === 0) {
          particle.va = 20 * (-0.5 + Math.random());
        }
        
        // Update x scale based on velocity
        particle.scaleX = particle.v * 10 / 100; // Normalize scale
        
        // Update t (decay factor)
        particle.t *= 0.999;
        
        // Update angle
        particle.angle += particle.va;
        
        // Calculate velocity components (exact AS formulas)
        const vx = Math.abs(particle.v * Math.cos(particle.angle * 0.017453292519943295));
        const vy = particle.v * Math.sin(particle.angle * 0.017453292519943295);
        
        // Update position
        particle.x += vx * deltaFrames;
        particle.y += vy * deltaFrames;
        
        // Decay velocity
        particle.v *= 0.95;
        
        // Update rotation to match angle
        particle.rotation = particle.angle;
        
        // Check if particle should die
        if (particle.v < 0.01) {
          particle.alive = false;
        }
      };
      
      return { 
        x, 
        y,
        scaleX: v * 10 / 100, // Initial x scale based on velocity
        scaleY: 1,
        alpha: 1,
        rotation: angle,
        customData: { angle, v, va, t },
        customUpdate
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    
    // Update fade effect
    if (this.isFading && this.currentAlpha > 0) {
      const deltaFrames = deltaTime * 60 / 1000; // Convert to 60fps frames
      this.currentAlpha -= this.fadePerFrame * deltaFrames;
      if (this.currentAlpha < 0) {
        this.currentAlpha = 0;
      }
      this.shootAnim.sprite.alpha = this.currentAlpha / 100;
    }
    
    // Update particle systems
    if (this.particles4) {
      this.particles4.update();
    }
    if (this.particles6) {
      this.particles6.update();
    }

    // Check completion
    if (this.shootAnim.isComplete()) {
      const particles4Done = !this.particles4 || !this.particles4.hasAliveParticles();
      const particles6Done = !this.particles6 || !this.particles6.hasAliveParticles();
      
      if (particles4Done && particles6Done) {
        this.complete();
      }
    }
  }

  destroy(): void {
    if (this.particles4) {
      this.particles4.destroy();
    }
    if (this.particles6) {
      this.particles6.destroy();
    }
    super.destroy();
  }
}