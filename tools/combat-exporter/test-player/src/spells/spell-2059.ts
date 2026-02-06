/**
 * Spell 2059 - Unknown
 *
 * A projectile spell with explosion particles and continuous smoke trail.
 *
 * Components:
 * - shoot: Main projectile animation with rotation
 * - fumee2: Initial explosion particles (7 particles)
 * - fumee: Continuous trail particles (2 per frame)
 *
 * Original AS timing:
 * - Frame 1: Spawn 7 fumee2 particles
 * - Frame 73: Main animation ends and removes parent
 * - fumee2: Runs for 49 frames with gravity
 * - fumee: Runs for 46 frames with friction
 */

import { Container, Sprite } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 796.8000000000001,
  height: 532.5,
  offsetX: -464.40000000000003,
  offsetY: -451.20000000000005,
};

const FUMEE2_MANIFEST: SpriteManifest = {
  width: 79.5,
  height: 49.5,
  offsetX: -50.699999999999996,
  offsetY: -43.8,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 12,
  height: 12.299999999999999,
  offsetX: -1.7999999999999998,
  offsetY: -3.3000000000000003,
};

export class Spell2059 extends BaseSpell {
  readonly spellId = 2059;

  private shootAnim!: FrameAnimatedSprite;
  private fumee2Particles!: ASParticleSystem;
  private fumeeParticles!: ASParticleSystem;
  private moveContainer!: Container;
  private rotatingSprite1!: Sprite;
  private rotatingSprite2!: Sprite;
  private frameCount = 0;
  private lastX = 0;
  private lastY = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    
    // Set initial rotation from DefineSprite_10
    this.shootAnim.sprite.rotation = Math.floor(Math.random() * 360) * (Math.PI / 180);
    
    this.container.addChild(this.shootAnim.sprite);

    // Create move container for particle spawning
    this.moveContainer = new Container();
    this.container.addChild(this.moveContainer);

    // Create rotating sprites (DefineSprite_7)
    const rotatingTexture = textures.getFrames('shoot')[0];
    if (rotatingTexture) {
      this.rotatingSprite1 = new Sprite(rotatingTexture);
      this.rotatingSprite1.anchor.set(0.5);
      this.rotatingSprite1.scale.set(init.scale);
      
      this.rotatingSprite2 = new Sprite(rotatingTexture);
      this.rotatingSprite2.anchor.set(0.5);
      this.rotatingSprite2.scale.set(init.scale);
      this.rotatingSprite2.rotation = (150 * Math.PI) / 180;
      
      this.moveContainer.addChild(this.rotatingSprite1);
      this.moveContainer.addChild(this.rotatingSprite2);
    }

    // Initialize particle systems
    const fumee2Texture = textures.getFrames('lib_fumee2')[0];
    if (fumee2Texture) {
      this.fumee2Particles = new ASParticleSystem(fumee2Texture);
      this.container.addChildAt(this.fumee2Particles.container, 0);
    }

    const fumeeTexture = textures.getFrames('lib_fumee')[0];
    if (fumeeTexture) {
      this.fumeeParticles = new ASParticleSystem(fumeeTexture);
      this.container.addChildAt(this.fumeeParticles.container, 0);
    }

    // Store initial position
    this.lastX = this.shootAnim.sprite.x;
    this.lastY = this.shootAnim.sprite.y - 30;

    // Spawn initial fumee2 particles (from DefineSprite_3_shoot frame_1)
    this.spawnInitialParticles();

    // Stop at frame 73 (0-indexed: 72)
    this.shootAnim.onFrame(72, () => {
      // From DefineSprite_3_shoot frame_73: this._parent.removeMovieClip();
      this.complete();
    });
  }

  private spawnInitialParticles(): void {
    if (!this.fumee2Particles) return;

    // Spawn 7 particles at y - 30
    for (let i = 0; i < 7; i++) {
      // From DefineSprite_11_fumee2 onClipEvent(load)
      const scale = 20 * Math.random() + 80;
      const startFrame = Math.floor(Math.random() * 45);
      
      const particle = this.fumee2Particles.spawn({
        x: this.shootAnim.sprite.x,
        y: this.shootAnim.sprite.y - 30,
        vx: 5 * (Math.random() - 0.5),
        vy: -7 * Math.random(),
        t: scale,
        vt: -scale / 49, // Will reach 0 at frame 49
        rotation: 0,
        vr: 0,
      });

      if (particle) {
        // Double velocities as per AS
        particle.vx *= 2;
        particle.vy *= 2;
        
        // Set gravity for fumee2
        particle.gravity = 0.5;
        
        // Random start frame
        const frames = this.fumee2Particles.texture.textures || [];
        if (frames.length > startFrame) {
          particle.sprite.texture = frames[startFrame];
        }
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    
    // Update rotating sprites (DefineSprite_7)
    if (this.rotatingSprite1) {
      const rotSpeed = (-33 + Math.floor(Math.random() * 66)) * (Math.PI / 180);
      this.rotatingSprite1.rotation += rotSpeed;
    }
    
    if (this.rotatingSprite2) {
      this.rotatingSprite2.rotation += (150 * Math.PI) / 180;
    }

    // Track movement for trail particles
    const currentX = this.shootAnim.sprite.x;
    const currentY = this.shootAnim.sprite.y;

    // Spawn trail particles (DefineSprite_6_move)
    if (this.fumeeParticles && this.frameCount > 0) {
      for (let i = 0; i < 2; i++) {
        // From DefineSprite_13_fumee onClipEvent(load)
        const scale = 50 * Math.random() + 50;
        const startFrame = Math.floor(Math.random() * 30);
        const divisor = 3 + Math.floor(Math.random() * 3);
        
        const particle = this.fumeeParticles.spawn({
          x: currentX,
          y: currentY,
          vx: (currentX - this.lastX) + 10 * (Math.random() - 0.5),
          vy: (currentY - this.lastY) + 10 * (Math.random() - 0.5),
          t: scale,
          vt: -scale / 46, // Will reach 0 at frame 46
          rotation: 0,
          vr: 0,
        });

        if (particle) {
          // Divide velocities by random divisor
          particle.vx /= divisor;
          particle.vy /= divisor;
          
          // Set friction for fumee
          particle.accX = 1 / 1.2;
          particle.accY = 1 / 1.2;
          
          // Random start frame
          const frames = this.fumeeParticles.texture.textures || [];
          if (frames.length > startFrame) {
            particle.sprite.texture = frames[startFrame];
          }
        }
      }
    }

    // Update particle systems
    if (this.fumee2Particles) {
      this.fumee2Particles.update();
    }
    if (this.fumeeParticles) {
      this.fumeeParticles.update();
    }

    // Update position tracking
    this.lastX = currentX;
    this.lastY = currentY;
    this.frameCount++;

    // Update move container position
    if (this.moveContainer) {
      this.moveContainer.position.set(currentX, currentY);
    }
  }

  destroy(): void {
    if (this.fumee2Particles) {
      this.fumee2Particles.destroy();
    }
    if (this.fumeeParticles) {
      this.fumeeParticles.destroy();
    }
    super.destroy();
  }
}