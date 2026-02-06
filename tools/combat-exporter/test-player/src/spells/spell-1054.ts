/**
 * Spell 1054 - Sacrieur Spell
 *
 * Complex particle-based effect with multiple layers of animated elements.
 * Creates a persistent visual effect with various particle behaviors.
 *
 * Components:
 * - anim1: Main composite animation (306 frames)
 * - Multiple particle systems with different physics behaviors
 *
 * Original AS timing:
 * - Frame 19: First sound effect and particle spawn
 * - Frame 106: Second sound effect
 * - Frame 196: Third sound effect
 * - Frame 304: Animation cleanup
 */

import { Texture, Container, Sprite, Graphics } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const MAIN_MANIFEST: SpriteManifest = {
  width: 353.7,
  height: 277.8,
  offsetX: -135.6,
  offsetY: -181.8,
};

interface CustomParticle {
  sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  v: number;
  rotation: number;
  rotationSpeed: number;
  alpha: number;
  phase: number;
  phaseSpeed: number;
  scale: number;
  baseScale: number;
  alive: boolean;
  fadeSpeed: number;
  type: 'bouncing' | 'oscillating' | 'flickering' | 'floating';
}

export class Spell1054 extends BaseSpell {
  readonly spellId = 1054;

  private mainAnim!: FrameAnimatedSprite;
  private particles: CustomParticle[] = [];
  private particleContainer!: Container;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Create particle container
    this.particleContainer = new Container();
    this.container.addChild(this.particleContainer);

    // Main animation
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(MAIN_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.mainAnim.sprite);

    // Sound effects at specific frames
    this.mainAnim
      .onFrame(18, () => {
        this.callbacks.playSound('sacrieur_1054');
        this.spawnParticles(textures);
      })
      .onFrame(105, () => {
        this.callbacks.playSound('sacrieur_1054');
      })
      .onFrame(195, () => {
        this.callbacks.playSound('sacrieur_1054');
      });

    // Signal hit around the middle of the animation
    this.mainAnim.onFrame(150, () => this.signalHit());
  }

  private spawnParticles(textures: SpellTextureProvider): void {
    // Create simple colored particles as placeholders for the various particle types
    const particleGraphics = new Graphics();
    particleGraphics.beginFill(0xffaa00);
    particleGraphics.drawCircle(0, 0, 8);
    particleGraphics.endFill();
    
    const particleTexture = textures.renderer?.generateTexture(particleGraphics) || Texture.EMPTY;
    particleGraphics.destroy();

    // Spawn bouncing particles (DefineSprite_4)
    for (let i = 0; i < 5; i++) {
      const sprite = new Sprite(particleTexture);
      sprite.anchor.set(0.5);
      
      const particle: CustomParticle = {
        sprite,
        x: (Math.random() - 0.5) * 100,
        y: -50 - Math.random() * 50,
        vx: (Math.random() - 0.5) * 5,
        vy: 0,
        v: 0,
        rotation: 0,
        rotationSpeed: 0,
        alpha: 1,
        phase: 0,
        phaseSpeed: 0,
        scale: 1,
        baseScale: 1,
        alive: true,
        fadeSpeed: 0,
        type: 'bouncing'
      };
      
      sprite.position.set(particle.x, particle.y);
      this.particleContainer.addChild(sprite);
      this.particles.push(particle);
    }

    // Spawn oscillating particles (DefineSprite_19)
    for (let i = 0; i < 8; i++) {
      const sprite = new Sprite(particleTexture);
      sprite.anchor.set(0.5);
      
      const particle: CustomParticle = {
        sprite,
        x: (Math.random() - 0.5) * 150,
        y: (Math.random() - 0.5) * 100,
        vx: 0,
        vy: 0,
        v: 0,
        rotation: Math.floor(Math.random() * 360) - 90,
        rotationSpeed: 0,
        alpha: (Math.floor(Math.random() * 50) + 40) / 100,
        phase: Math.random() * 6,
        phaseSpeed: 0.1,
        scale: 1,
        baseScale: (80 + Math.floor(Math.random() * 50)) / 100,
        alive: true,
        fadeSpeed: 0,
        type: 'oscillating'
      };
      
      sprite.position.set(particle.x, particle.y);
      sprite.rotation = (particle.rotation * Math.PI) / 180;
      sprite.alpha = particle.alpha;
      sprite.scale.set(particle.baseScale);
      this.particleContainer.addChild(sprite);
      this.particles.push(particle);
    }

    // Spawn flickering particles (DefineSprite_20)
    for (let i = 0; i < 6; i++) {
      const sprite = new Sprite(particleTexture);
      sprite.anchor.set(0.5);
      
      const particle: CustomParticle = {
        sprite,
        x: (Math.random() - 0.5) * 200,
        y: (Math.random() - 0.5) * 150,
        vx: 0,
        vy: 0,
        v: 0,
        rotation: Math.floor(Math.random() * 360),
        rotationSpeed: 0,
        alpha: Math.floor(Math.random() * 170) / 255,
        phase: 0,
        phaseSpeed: 0,
        scale: 0.8,
        baseScale: 0.8,
        alive: true,
        fadeSpeed: 0,
        type: 'flickering'
      };
      
      sprite.position.set(particle.x, particle.y);
      sprite.rotation = (particle.rotation * Math.PI) / 180;
      sprite.alpha = particle.alpha;
      sprite.scale.set(particle.scale);
      this.particleContainer.addChild(sprite);
      this.particles.push(particle);
    }

    // Spawn floating particles (DefineSprite_21)
    for (let i = 0; i < 10; i++) {
      const sprite = new Sprite(particleTexture);
      sprite.anchor.set(0.5);
      
      const particle: CustomParticle = {
        sprite,
        x: (Math.random() - 0.5) * 100,
        y: 0,
        vx: 0,
        vy: -(0.3 + 0.67 * Math.random()),
        v: 0,
        rotation: Math.floor(Math.random() * 360),
        rotationSpeed: 1.33,
        alpha: 0.1,
        phase: 0,
        phaseSpeed: 0.067 + 0.067 * Math.random(),
        scale: 1,
        baseScale: 1,
        alive: true,
        fadeSpeed: 6.67 / 100,
        type: 'floating'
      };
      
      sprite.position.set(particle.x, particle.y);
      sprite.rotation = (particle.rotation * Math.PI) / 180;
      sprite.alpha = particle.alpha;
      sprite.scale.set(particle.scale);
      this.particleContainer.addChild(sprite);
      this.particles.push(particle);
    }
  }

  private updateParticles(): void {
    for (const particle of this.particles) {
      if (!particle.alive) continue;

      switch (particle.type) {
        case 'bouncing': {
          // DefineSprite_4 physics
          particle.y += particle.v;
          particle.x += particle.vx;
          particle.v += 0.6;
          
          if (particle.y > 0) {
            particle.y = 0;
            particle.v = -5 * Math.random();
            particle.vx = -2.5 * Math.random() + 1.25;
          }
          break;
        }

        case 'oscillating': {
          // DefineSprite_19 physics
          particle.phase += particle.phaseSpeed;
          particle.scale = particle.baseScale * Math.abs(Math.sin(particle.phase));
          break;
        }

        case 'flickering': {
          // DefineSprite_20 physics
          particle.alpha = Math.floor(Math.random() * 170) / 255;
          break;
        }

        case 'floating': {
          // DefineSprite_21 physics
          if (particle.y > -50 && particle.alpha < 1) {
            particle.alpha = Math.min(1, particle.alpha + particle.fadeSpeed);
          }
          
          if (particle.y < -50) {
            particle.alpha -= particle.fadeSpeed;
            if (particle.alpha <= 0) {
              particle.alive = false;
              particle.sprite.visible = false;
              continue;
            }
          }
          
          particle.rotation += particle.rotationSpeed;
          const p = particle.y;
          particle.y = 5 * Math.cos(particle.phase) + (p - particle.vy);
          particle.x = 25 * Math.sin(particle.phase);
          particle.phase += particle.phaseSpeed;
          
          if (Math.cos(particle.phase) < 0) {
            particle.alpha = (80 * Math.cos(particle.phase) + 100) / 255;
          }
          break;
        }
      }

      // Apply updates to sprite
      particle.sprite.position.set(particle.x, particle.y);
      particle.sprite.rotation = (particle.rotation * Math.PI) / 180;
      particle.sprite.scale.set(particle.scale);
      particle.sprite.alpha = Math.max(0, Math.min(1, particle.alpha));
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updateParticles();

    // Check if main animation is complete
    if (this.mainAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    // Clean up particles
    for (const particle of this.particles) {
      particle.sprite.destroy();
    }
    this.particles = [];
    
    this.particleContainer.destroy({ children: true });
    super.destroy();
  }
}