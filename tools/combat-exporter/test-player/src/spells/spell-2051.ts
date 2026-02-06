/**
 * Spell 2051 - Spiraling Projectile
 *
 * A spiraling projectile that moves from caster to target with a trail of fading particles.
 * Features complex acceleration/deceleration patterns and randomized visual effects.
 *
 * Components:
 * - sprite_14: Main spiral animation with embedded trail spawner
 * - sprite_21: End animation at target position
 * - cercle particles: Fading circular trail particles
 *
 * Original AS timing:
 * - Frame 1-28: Spiral motion with deceleration then acceleration
 * - Frame 55: Hit signal
 * - Frame 82: Complete
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

interface CircleParticle {
  sprite: FrameAnimatedSprite;
  vx: number;
  vy: number;
  va: number;
  r: number;
}

export class Spell2051 extends BaseSpell {
  readonly spellId = 2051;

  private mainSpiral!: FrameAnimatedSprite;
  private trailSpawner!: Container;
  private endAnim!: FrameAnimatedSprite;
  private circleParticles: CircleParticle[] = [];
  private particleTexture!: Texture[];
  
  // Spiral motion parameters
  private spiralX!: number;
  private spiralY!: number;
  private dx!: number;
  private dy!: number;
  private d!: number;
  private rotation!: number;
  private a = 0;
  private b = 0;
  private t = 0;
  private v = 0.3;
  private size!: number;
  private nFramesToIgnore = 2;
  private nCurrentFrameState = 0;
  private particleCounter = 100;
  private lastX = 0;
  private lastY = 0;
  private pi = 3.1415;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Get particle texture
    this.particleTexture = textures.getFrames('lib_cercle');

    // Calculate spiral parameters
    const x = 0;
    const y = init.casterY;
    this.spiralX = x;
    this.spiralY = y;
    this.dx = init.targetX;
    this.dy = init.targetY - init.casterY;
    this.d = Math.sqrt(this.dx * this.dx + this.dy * this.dy) / 2;
    this.rotation = Math.atan2(this.dy, this.dx) * 180 / 3.1415;

    // Random size factor
    this.size = 0.8 + 3 * Math.random();

    // Create main spiral animation
    const spiralManifest = textures.getManifest('sprite_14');
    this.mainSpiral = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_14'),
      anchor: calculateAnchor(spiralManifest),
      loop: false,
      animationSpeed: 1,
      scale: init.scale,
      onFrame: (frame) => {
        if (frame === 0) {
          this.callbacks.playSound('wab_swirl');
        }
      }
    }));
    this.mainSpiral.rotation = this.rotation * Math.PI / 180;
    this.container.addChild(this.mainSpiral);

    // Create trail spawner container
    this.trailSpawner = new Container();
    this.mainSpiral.addChild(this.trailSpawner);
    this.trailSpawner.scale.set(1 / init.scale);
    
    // Initialize last position for particle spawning
    this.lastX = this.spiralX;
    this.lastY = this.spiralY;

    // Create end animation (initially hidden)
    const endManifest = textures.getManifest('sprite_21');
    this.endAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_21'),
      anchor: calculateAnchor(endManifest),
      loop: false,
      animationSpeed: 1,
      scale: init.scale,
      onFrame: (frame) => {
        if (frame === 54) {
          this.signalHit();
        }
      }
    }));
    this.endAnim.position.set(init.targetX, init.targetY);
    this.endAnim.visible = false;
    this.container.addChild(this.endAnim);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update animations
    this.anims.update(deltaTime);

    // Update spiral motion
    if (!this.mainSpiral.isComplete()) {
      this.updateSpiralMotion();
    }

    // Update circle particles
    this.updateCircleParticles();

    // Check completion
    if (this.endAnim.isComplete()) {
      this.complete();
    }
  }

  private updateSpiralMotion(): void {
    if (this.t > 28) {
      // Transition to end animation
      this.mainSpiral.visible = false;
      this.endAnim.visible = true;
      this.endAnim.play();
      return;
    }

    let newX: number;
    let newY: number;

    if (this.nCurrentFrameState > 0) {
      // Frame skip state
      this.b = this.a;
      this.b += this.v / 3;
      newX = this.d + this.d * Math.cos(this.pi + this.b);
      newY = this.d * Math.sin(this.b) / this.size;
      this.nCurrentFrameState--;
    } else {
      // Normal state
      newX = this.d + this.d * Math.cos(this.pi + this.a);
      newY = this.d * Math.sin(this.a) / this.size;
      this.a += this.v;
      this.t++;
      
      if (this.t <= 14) {
        this.v -= 0.015;
      } else {
        this.v += 0.03;
      }
      
      this.nCurrentFrameState = this.nFramesToIgnore;
    }

    // Apply rotation transformation to get world coordinates
    const cosR = Math.cos(this.rotation * Math.PI / 180);
    const sinR = Math.sin(this.rotation * Math.PI / 180);
    const worldX = this.spiralX + newX * cosR - newY * sinR;
    const worldY = this.spiralY + newX * sinR + newY * cosR;

    // Update main spiral position
    this.mainSpiral.position.set(worldX, worldY);

    // Spawn trail particle
    this.spawnCircleParticle(worldX, worldY);

    // Update last position
    this.lastX = worldX;
    this.lastY = worldY;
  }

  private spawnCircleParticle(x: number, y: number): void {
    // Calculate velocity based on position change
    const vx = x - this.lastX;
    const vy = y - this.lastY;

    // Create particle sprite
    const particleSprite = new FrameAnimatedSprite({
      textures: this.particleTexture,
      anchor: { x: 0.5, y: 0.5 },
      loop: false,
      animationSpeed: 1,
      scale: 1 / 6,
    });

    // Random parameters
    const va = 8 - Math.floor(Math.random() * 3);
    const t = 60 + Math.floor(Math.random() * 70);
    const alpha = 90 + Math.floor(Math.random() * 30);
    const r = 1.3 + 0.5 * Math.random();

    // Set initial properties
    particleSprite.scale.set(t / 100 / 6);
    particleSprite.alpha = alpha / 100;
    particleSprite.position.set(x, y);

    // Add rotating child sprite
    const rotatingSprite = new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_5'),
      anchor: { x: 0.5, y: 0.5 },
      loop: false,
      animationSpeed: 0,
      scale: 1,
    });
    const vr = Math.floor(Math.random() * 100) + 50;
    rotatingSprite.rotation = Math.floor(Math.random() * 360) * Math.PI / 180;
    rotatingSprite.currentFrame = Math.floor(Math.random() * 10);
    particleSprite.addChild(rotatingSprite);

    // Store particle data
    const particle: CircleParticle = {
      sprite: particleSprite,
      vx: vx,
      vy: vy,
      va: va,
      r: r
    };

    this.circleParticles.push(particle);
    this.container.addChild(particleSprite);
    this.particleCounter++;

    // Store rotation velocity on the rotating sprite
    (rotatingSprite as any).vr = vr;
  }

  private updateCircleParticles(): void {
    for (let i = this.circleParticles.length - 1; i >= 0; i--) {
      const particle = this.circleParticles[i];
      
      // Update alpha
      particle.sprite.alpha -= particle.va / 100;
      
      if (particle.sprite.alpha < 0.1) {
        // Remove particle
        particle.sprite.destroy();
        this.circleParticles.splice(i, 1);
        continue;
      }

      // Update position
      particle.sprite.x += particle.vx;
      particle.sprite.y += particle.vy;
      
      // Apply friction
      particle.vx /= particle.r;
      particle.vy /= particle.r;

      // Update rotation of child sprite
      const rotatingSprite = particle.sprite.children[0];
      if (rotatingSprite && (rotatingSprite as any).vr) {
        (rotatingSprite as any).vr /= particle.r;
        rotatingSprite.rotation += (rotatingSprite as any).vr * Math.PI / 180;
      }
    }
  }

  destroy(): void {
    // Clean up particles
    for (const particle of this.circleParticles) {
      particle.sprite.destroy();
    }
    this.circleParticles = [];
    
    super.destroy();
  }
}