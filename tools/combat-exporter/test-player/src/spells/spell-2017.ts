/**
 * Spell 2017 - Smoke Projectile
 *
 * A projectile spell with smoke trail and impact particles
 *
 * Components:
 * - fumee2: Smoke particles at launch and impact
 * - fumee: Continuous smoke trail during flight
 * - DefineSprite_1_shoot: Main projectile (73 frames)
 * - DefineSprite_4_move: Moving component with trail spawner
 *
 * Original AS timing:
 * - Frame 1: Spawn 7 launch smoke particles
 * - Continuous: Spawn 0.67 trail particles per frame
 * - Frame 73: Projectile ends
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  type ASParticleConfig,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

export class Spell2017 extends BaseSpell {
  readonly spellId = 2017;

  private launchParticles!: ASParticleSystem;
  private trailParticles!: ASParticleSystem;
  private particleAccumulator = 0;
  private projectileContainer!: Container;
  private moveContainer!: Container;
  private rotatingElement!: Container;
  private projectileVx = 0;
  private projectileVy = 0;
  private projectileX = 0;
  private projectileY = 0;
  private frameCounter = 0;
  private projectileDone = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Create particle systems for launch smoke (fumee2)
    const fumee2Frames = textures.getFrames('lib_fumee2');
    this.launchParticles = new ASParticleSystem(fumee2Frames[0] ?? Texture.EMPTY);
    this.launchParticles.container.position.set(0, init.casterY);
    this.container.addChild(this.launchParticles.container);

    // Create particle system for trail smoke (fumee)
    const fumeeFrames = textures.getFrames('lib_fumee');
    this.trailParticles = new ASParticleSystem(fumeeFrames[0] ?? Texture.EMPTY);
    this.container.addChild(this.trailParticles.container);

    // Create projectile container (DefineSprite_1_shoot)
    this.projectileContainer = new Container();
    this.projectileContainer.position.set(0, init.casterY);
    this.container.addChild(this.projectileContainer);

    // Calculate projectile velocity based on target direction
    const distance = Math.sqrt(init.targetX * init.targetX + (init.targetY - init.casterY) * (init.targetY - init.casterY));
    const speed = distance / 73; // Projectile travels for 73 frames
    if (distance > 0) {
      this.projectileVx = (init.targetX / distance) * speed;
      this.projectileVy = ((init.targetY - init.casterY) / distance) * speed;
    }

    // Set initial projectile position
    this.projectileX = 0;
    this.projectileY = init.casterY;

    // Create moving component container (DefineSprite_4_move)
    this.moveContainer = new Container();
    this.projectileContainer.addChild(this.moveContainer);

    // Create rotating element
    this.rotatingElement = new Container();
    
    // Create oscillating element (DefineSprite_7)
    const oscillatingElement = new Container();
    const oscillatingChild = new Container();
    oscillatingElement.addChild(oscillatingChild);
    
    // Random oscillation speed
    const vr = 0.04 + 0.01 * Math.random();
    let i = 0;
    
    // Store the oscillation update function
    const oscillateUpdate = () => {
      i += vr;
      oscillatingChild.scale.y = Math.sin(i);
    };
    this.moveContainer.addChild(oscillatingElement);

    // Add visual element that randomly selects frame (DefineSprite_12)
    const randomFrame = Math.floor(Math.random() * 6) + 1; // Random frame 2-7 (0-indexed: 1-6)
    
    // Spawn launch particles
    this.spawnLaunchParticles();

    // Create update handler for projectile movement
    const projectileUpdate = () => {
      if (this.projectileDone) {
        return;
      }

      this.frameCounter++;

      // Update projectile position
      this.projectileX += this.projectileVx;
      this.projectileY += this.projectileVy;
      this.projectileContainer.position.set(this.projectileX, this.projectileY);

      // Rotate element
      this.rotatingElement.rotation += (35 * Math.PI) / 180;

      // Oscillate element
      oscillateUpdate();

      // Spawn trail particles
      this.particleAccumulator += 0.67;
      while (this.particleAccumulator >= 1) {
        this.particleAccumulator -= 1;
        this.spawnTrailParticle();
      }

      // End projectile after 73 frames
      if (this.frameCounter >= 73) {
        this.projectileDone = true;
        this.projectileContainer.visible = false;
        this.signalHit();
      }
    };

    // Store update function
    (this as any).projectileUpdate = projectileUpdate;
  }

  private spawnLaunchParticles(): void {
    // Spawn 7 smoke particles at launch
    for (let i = 0; i < 7; i++) {
      this.launchParticles.spawn(this.createLaunchParticleConfig());
    }
  }

  private createLaunchParticleConfig(): ASParticleConfig {
    const scale = 0.5 + 0.5 * Math.random();
    const vx = 5 * (Math.random() - 0.5);
    const vy = -6 * Math.random();
    const vr = 30 * Math.random() - 0.5;
    
    return {
      x: 0,
      y: 0,
      vx,
      vy,
      scale,
      vr,
      onUpdate: (particle) => {
        // Apply gravity
        particle.vy += 0.5;
        
        // Check ground collision
        if (particle.y >= particle.yi) {
          particle.vy = -particle.vy / 9;
          particle.vr = 0;
          particle.vx = 0;
          
          // Start fading
          particle.alpha -= 3.3 / 100; // 3.3 per frame at 60fps
          if (particle.alpha <= 0) {
            particle.alive = false;
          }
        }
      },
      life: 55 // Frame 55 removal
    };
  }

  private spawnTrailParticle(): void {
    this.trailParticles.spawn(this.createTrailParticleConfig());
  }

  private createTrailParticleConfig(): ASParticleConfig {
    const scale = 0.5 + 0.5 * Math.random();
    const vx = this.projectileVx + 6.67 * (Math.random() - 0.5);
    const vy = this.projectileVy + 6.67 * (Math.random() - 0.5);
    const divisor = 3 + Math.floor(Math.random() * 4); // 3-6
    const startFrame = Math.floor(Math.random() * 31); // 0-30
    
    return {
      x: this.projectileX,
      y: this.projectileY,
      vx: vx / divisor,
      vy: vy / divisor,
      scale,
      life: 46, // Frame 46 removal
      startFrame,
      onUpdate: (particle) => {
        // Velocity dampening
        particle.vx /= 1.2;
        particle.vy /= 1.2;
      }
    };
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update projectile movement
    if ((this as any).projectileUpdate) {
      (this as any).projectileUpdate();
    }

    // Update particle systems
    this.launchParticles.update();
    this.trailParticles.update();

    // Check completion - all particles must be done
    if (this.projectileDone && 
        !this.launchParticles.hasAliveParticles() && 
        !this.trailParticles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.launchParticles.destroy();
    this.trailParticles.destroy();
    super.destroy();
  }
}