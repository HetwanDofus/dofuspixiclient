/**
 * Spell 2011 - Larve Bleue
 *
 * A projectile spell with smoke particle effects.
 *
 * Components:
 * - shoot: Main projectile animation
 * - fumee2: Larger smoke particles spawned during shooting
 * - fumee: Smaller smoke particles for movement trail
 *
 * Original AS timing:
 * - Frame 1: Play "larve_tir" sound, spawn 3 smoke particles
 * - Frame 37: Spawn 9 more smoke particles
 * - Frame 91: End of animation
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 796.8,
  height: 532.5,
  offsetX: -464.4,
  offsetY: -451.2,
};

const FUMEE2_MANIFEST: SpriteManifest = {
  width: 79.5,
  height: 58.8,
  offsetX: -50.7,
  offsetY: -43.8,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 14.1,
  height: 33,
  offsetX: -18.3,
  offsetY: 0,
};

export class Spell2011 extends BaseSpell {
  readonly spellId = 2011;

  private shootAnim!: FrameAnimatedSprite;
  private smokeParticles: FrameAnimatedSprite[] = [];
  private level = 1;
  private particleCounter = 0;
  private fumee2Textures!: any[];
  private fumeeTextures!: any[];

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Store textures for particles
    this.fumee2Textures = textures.getFrames('fumee2');
    this.fumeeTextures = textures.getFrames('fumee');

    // Main shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;
    
    // Set up frame callbacks
    this.shootAnim
      .onFrame(0, () => {
        this.callbacks.playSound('larve_tir');
        this.spawnShootParticles(3, init);
      })
      .onFrame(36, () => {
        this.spawnShootParticles(9, init);
      });

    this.container.addChild(this.shootAnim.sprite);

    // Create movement trail particles (from DefineSprite_8_move)
    this.createMovementTrail(init);
  }

  private spawnShootParticles(count: number, init: SpellInitContext): void {
    for (let i = 0; i < count; i++) {
      this.particleCounter++;
      
      // From AS: attachMovie("fumee2", "s" + c++, 200 + c++);
      // Position: mc._x = _parent._x; mc._y = _parent._y - 30;
      const x = 0;
      const y = init.casterY - 30;
      
      // Velocity from AS: mc.vx = 6.67 * (Math.random() - 0.5);
      const vx = 6.67 * (Math.random() - 0.5);
      const vy = 6.67 * (Math.random() - 0.5);
      
      // From fumee2 frame 1: t = 20 * Math.random() + 80
      const scale = (20 * Math.random() + 80) / 100;
      
      // From fumee2 frame 1: this.gotoAndPlay(random(45));
      const startFrame = Math.floor(Math.random() * 45);
      
      // Create animated particle
      const particle = new FrameAnimatedSprite({
        textures: this.fumee2Textures,
        ...calculateAnchor(FUMEE2_MANIFEST),
        scale: init.scale * scale,
        startFrame,
      });
      
      particle.sprite.position.set(x, y);
      
      // Store physics properties on the sprite for update
      (particle.sprite as any).vx = vx * 2; // From AS: vx *= 2
      (particle.sprite as any).vy = vy * 2; // From AS: vy *= 2
      (particle.sprite as any).accX = 1 / 1.1; // From AS: _x += (vx /= 1.1)
      (particle.sprite as any).accY = 1 / 1.1;
      
      this.smokeParticles.push(particle);
      this.container.addChildAt(particle.sprite, 0);
    }
  }

  private createMovementTrail(init: SpellInitContext): void {
    // From DefineSprite_8_move: nf = this._parent.level * 1
    const particlesPerFrame = this.level * 1;
    
    // Create particles during the animation
    const createTrailParticles = () => {
      if (this.done || this.shootAnim.isComplete()) {
        return;
      }
      
      // Create nf particles per frame
      for (let i = 0; i < particlesPerFrame; i++) {
        this.particleCounter++;
        
        // From AS: attachMovie("fumee", "s" + c++, 10 + c++);
        const x = 0;
        const y = init.casterY - 30;
        
        // Same velocity calculation as shoot particles
        const vx = 6.67 * (Math.random() - 0.5);
        const vy = 6.67 * (Math.random() - 0.5);
        
        // From fumee frame 1: t = 50 * Math.random() + 50
        const scale = (50 * Math.random() + 50) / 100;
        
        // From fumee frame 1: this.gotoAndPlay(random(30));
        const startFrame = Math.floor(Math.random() * 30);
        
        // From fumee frame 1: vx /= 3 + random(4);
        const divisor = 3 + Math.floor(Math.random() * 4);
        
        // Create animated particle
        const particle = new FrameAnimatedSprite({
          textures: this.fumeeTextures,
          ...calculateAnchor(FUMEE_MANIFEST),
          scale: init.scale * scale,
          startFrame,
        });
        
        particle.sprite.position.set(x, y);
        
        // Store physics properties
        (particle.sprite as any).vx = vx / divisor;
        (particle.sprite as any).vy = vy / divisor;
        (particle.sprite as any).accX = 1 / 1.067; // From AS: _x += (vx /= 1.067)
        (particle.sprite as any).accY = 1 / 1.067;
        
        this.smokeParticles.push(particle);
        this.container.addChildAt(particle.sprite, 0);
      }
    };
    
    // Create particles on each frame update
    this.shootAnim.onUpdate(() => createTrailParticles());
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);
    
    // Update smoke particles physics and animation
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const particle = this.smokeParticles[i];
      const sprite = particle.sprite as any;
      
      // Update physics
      if (sprite.vx !== undefined) {
        sprite.vx *= sprite.accX;
        sprite.vy *= sprite.accY;
        sprite.x += sprite.vx;
        sprite.y += sprite.vy;
      }
      
      // Update animation
      particle.update(deltaTime);
      
      // Remove completed particles
      if (particle.isComplete()) {
        particle.destroy();
        this.smokeParticles.splice(i, 1);
      }
    }

    // Check completion when shoot animation ends
    if (this.shootAnim.isComplete()) {
      // No explicit hit signal in AS, so signal hit when animation completes
      this.signalHit();
      
      // Complete when all particles are gone
      if (this.smokeParticles.length === 0) {
        this.complete();
      }
    }
  }

  destroy(): void {
    for (const particle of this.smokeParticles) {
      particle.destroy();
    }
    this.smokeParticles = [];
    super.destroy();
  }
}