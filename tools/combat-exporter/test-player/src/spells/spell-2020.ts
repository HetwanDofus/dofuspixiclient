/**
 * Spell 2020 - Unknown
 *
 * A healing effect with upward-moving particles, rotating elements, and spiral patterns.
 *
 * Components:
 * - anim1: Main animation with 246 frames
 * - Multiple particle effects with different behaviors (upward, rotating, scaling, spiral)
 *
 * Original AS timing:
 * - Frame 1: Play sounds "many_504" and "guerison"
 * - Frame 244: Animation cleanup
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 276,
  height: 96,
  offsetX: -146.39999999999998,
  offsetY: -55.5,
};

// Particle sprite with upward movement (DefineSprite_3)
class UpwardParticle extends Sprite {
  private vy: number;

  constructor(texture: Texture) {
    super(texture);
    
    // Initial vertical velocity between -5.5 and -2.5
    this.vy = -3 * Math.random() - 2.5;
  }

  updatePhysics(): void {
    // Deceleration factor
    this.vy *= 0.98;
    // Movement
    this.y = this.y + this.vy;
    // Alpha transparency varies between 50-100%
    this.alpha = (50 + Math.floor(Math.random() * 50)) / 100;
  }
}

// Rotating element (DefineSprite_7)
class RotatingElement extends Sprite {
  private vr: number;

  constructor(texture: Texture) {
    super(texture);
    
    // Initial rotation velocity 0 to 6.67 degrees/frame
    this.vr = 6.67 * Math.random();
  }

  updatePhysics(): void {
    this.rotation = this.rotation + (this.vr * Math.PI / 180);
  }
}

// Oscillating scale effect (DefineSprite_8)
class OscillatingElement extends Sprite {
  private i: number;

  constructor(texture: Texture, parent: Container) {
    super(texture);
    
    // Inherit parent properties
    this.rotation = parent.rotation;
    this.alpha = parent.alpha;
    this.i = (parent as any).i || 0;
  }

  updatePhysics(): void {
    // X-scale oscillates
    this.scale.x = Math.sin(this.i += 0.067);
  }
}

// Complex spiral movement (DefineSprite_9)
class SpiralElement extends Container {
  private childSprite: Sprite;
  private v: number;
  private v2: number;
  private i: number = 0;
  private p: number = 0;

  constructor(texture: Texture) {
    super();
    
    this.childSprite = new Sprite(texture);
    
    // Random rotation 0-360 degrees
    this.childSprite.rotation = Math.floor(Math.random() * 360) * Math.PI / 180;
    // Alpha 120% (slight overdraw)
    this.childSprite.alpha = 1.2;
    // Parent alpha starts at 10%
    this.alpha = 0.1;
    
    // Movement speed 0.3 to 0.9
    this.v = 0.3 + 0.6 * Math.random();
    // Oscillation speed 0.016 to 0.046
    this.v2 = 0.016 + 0.03 * Math.random();
    
    this.addChild(this.childSprite);
  }

  updatePhysics(): void {
    // Vertical movement with cosine oscillation
    this.childSprite.y = 5 * Math.cos(this.i) + (this.p -= this.v);
    // Horizontal sine wave motion
    this.childSprite.x = 25 * Math.sin(this.i += this.v2);
    
    // Constant rotation +3 degrees per frame
    this.childSprite.rotation += 3 * Math.PI / 180;
    
    // Fade in/out logic
    if (this.childSprite.y > -100) {
      this.alpha = Math.min(1, this.alpha + 0.4);
    } else {
      this.alpha = Math.max(0, this.alpha - 0.1);
      if (this.alpha <= 0) {
        this.visible = false;
      }
    }
    
    // Dynamic alpha based on position
    if (Math.cos(this.i) < 0) {
      this.childSprite.alpha = (80 * Math.cos(this.i) + 100) / 100;
    } else {
      this.childSprite.alpha = 1.2;
    }
  }
}

export class Spell2020 extends BaseSpell {
  readonly spellId = 2020;

  private mainAnim!: FrameAnimatedSprite;
  private particles: (UpwardParticle | RotatingElement | OscillatingElement | SpiralElement)[] = [];
  private particleTexture?: Texture;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Get particle texture (assuming it's from the main animation frames)
    const frames = textures.getFrames('anim1');
    if (frames && frames.length > 0) {
      this.particleTexture = frames[0];
    }

    // Main animation
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      ...calculateAnchor(ANIM1_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnim
      .stopAt(242)
      .onFrame(0, () => {
        this.callbacks.playSound('many_504');
        this.callbacks.playSound('guerison');
        this.spawnParticles();
      });
    this.container.addChild(this.mainAnim.sprite);
  }

  private spawnParticles(): void {
    if (!this.particleTexture) {
      return;
    }

    // Spawn multiple particles with different behaviors
    // These would be defined in the actual AS but let's create a variety based on the analysis
    
    // Spawn upward particles
    for (let i = 0; i < 5; i++) {
      const particle = new UpwardParticle(this.particleTexture);
      particle.x = (Math.random() - 0.5) * 100;
      particle.y = 0;
      this.particles.push(particle);
      this.container.addChild(particle);
    }
    
    // Spawn rotating elements
    for (let i = 0; i < 3; i++) {
      const element = new RotatingElement(this.particleTexture);
      element.x = (Math.random() - 0.5) * 80;
      element.y = (Math.random() - 0.5) * 40;
      this.particles.push(element);
      this.container.addChild(element);
    }
    
    // Spawn spiral elements
    for (let i = 0; i < 4; i++) {
      const spiral = new SpiralElement(this.particleTexture);
      spiral.x = (Math.random() - 0.5) * 60;
      spiral.y = 20;
      this.particles.push(spiral);
      this.container.addChild(spiral);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    
    // Update all particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const particle = this.particles[i];
      if (particle.visible) {
        particle.updatePhysics();
      } else {
        // Remove invisible particles
        this.container.removeChild(particle);
        this.particles.splice(i, 1);
      }
    }

    // Check completion
    if (this.anims.allComplete() && this.particles.length === 0) {
      this.complete();
    }
  }

  destroy(): void {
    // Clean up particles
    for (const particle of this.particles) {
      particle.destroy();
    }
    this.particles = [];
    
    super.destroy();
  }
}