/**
 * Spell 2015 - Smoke Projectile
 *
 * Projectile spell with trailing smoke particles and initial burst.
 *
 * Components:
 * - Main projectile (DefineSprite_1_shoot): Moves and spawns particles
 * - Initial burst particles (fumee2): 5 bouncing smoke particles at start
 * - Trail particles (fumee): Continuous smoke trail (0.33 particles/frame)
 *
 * Original AS timing:
 * - Frame 1: Spawn 5 initial burst particles
 * - Frames 1-73: Continuous trail particle generation
 * - Frame 46: Trail particles self-destruct
 * - Frame 64: Burst particles self-destruct  
 * - Frame 73: Main projectile self-destructs
 */

import { Texture, Container, Sprite } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

// Sprite manifests from manifest.json
const FUMEE_MANIFEST: SpriteManifest = {
  width: 18,
  height: 18.6,
  offsetX: -4.800000000000001,
  offsetY: -6.300000000000001,
};

const FUMEE2_MANIFEST: SpriteManifest = {
  width: 18,
  height: 18.6,
  offsetX: -4.800000000000001,
  offsetY: -6.300000000000001,
};

export class Spell2015 extends BaseSpell {
  readonly spellId = 2015;

  // Particle systems
  private burstParticles!: ASParticleSystem;
  private trailParticles!: ASParticleSystem;
  
  // Projectile movement tracking
  private projectileContainer!: Container;
  private moveSprite!: Sprite; // DefineSprite_4_move
  private rotatingElements: Sprite[] = [];
  
  // Movement state
  private xi = 0;
  private yi = 0;
  private projectileX = 0;
  private projectileY = 0;
  private elapsedFrames = 0;
  private trailSpawnAccumulator = 0;
  private trailParticleCount = 0;
  private burstParticleCount = 0;
  
  // Constants from AS
  private readonly PROJECTILE_SPEED = 10; // Inferred from typical projectile speeds
  private readonly TRAIL_SPAWN_RATE = 0.33; // From AS: nf = 0.33
  private readonly ROTATION_SPEED = 50; // From AS: _rotation += 50

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Create projectile container
    this.projectileContainer = new Container();
    this.projectileContainer.position.set(0, init.casterY);
    this.container.addChild(this.projectileContainer);

    // Create move sprite (invisible, just for position tracking)
    this.moveSprite = new Sprite(Texture.EMPTY);
    this.moveSprite.position.set(0, 0);
    this.projectileContainer.addChild(this.moveSprite);

    // Initialize position tracking
    this.xi = 0;
    this.yi = 0;
    this.projectileX = 0;
    this.projectileY = 0;

    // Create rotating elements (DefineSprite_8 instances)
    // AS shows two rotating elements at _rotation += 50
    for (let i = 0; i < 2; i++) {
      const rotatingSprite = new Sprite(Texture.EMPTY);
      rotatingSprite.anchor.set(0.5);
      this.rotatingElements.push(rotatingSprite);
      this.projectileContainer.addChild(rotatingSprite);
    }

    // Setup burst particle system (fumee2)
    const fumee2Frames = textures.getFrames('lib_fumee2');
    if (fumee2Frames.length > 0) {
      this.burstParticles = new ASParticleSystem(fumee2Frames[0]);
      this.burstParticles.container.position.set(0, init.casterY);
      this.container.addChildAt(this.burstParticles.container, 0);
      
      // Spawn initial burst (5 particles)
      this.spawnInitialBurst();
    }

    // Setup trail particle system (fumee)
    const fumeeFrames = textures.getFrames('lib_fumee');
    if (fumeeFrames.length > 0) {
      this.trailParticles = new ASParticleSystem(fumeeFrames[0]);
      this.trailParticles.container.position.set(0, init.casterY);
      this.container.addChildAt(this.trailParticles.container, 0);
    }
  }

  private spawnInitialBurst(): void {
    // AS: while(p < 5)
    for (let p = 0; p < 5; p++) {
      // AS: f.vx = this._x - xi + 5 * (Math.random() - 0.5);
      const vx = 5 * (Math.random() - 0.5);
      // AS: f.vy = -7 * Math.random();
      const vy = -7 * Math.random();
      
      // From DefineSprite_9_fumee2/frame_1/DoAction.as
      const t = 20 * Math.random() + 80; // 80-100% scale
      const startFrame = Math.floor(Math.random() * 45); // random(45)
      const yi = this.projectileY - 15 + 30 * Math.random(); // Ground level variation
      
      const particle = this.burstParticles.spawn({
        x: this.projectileX,
        y: this.projectileY,
        vx: vx,
        vy: vy * 2, // AS: vy *= 2
        t: t,
        vt: 0,
        vtDecay: 0,
        rotation: startFrame * (360 / 45), // Convert frame to rotation
        gravity: 1.5, // AS: vy += 1.5
      });
      
      // Store ground level for bounce detection
      (particle as any).groundY = yi;
      this.burstParticleCount++;
    }
  }

  private spawnTrailParticle(): void {
    // From DefineSprite_4_move onEnterFrame
    const deltaX = this.projectileX - this.xi;
    const deltaY = this.projectileY - this.yi;
    
    // AS: _loc2_.vx = this._x - xi + 6.67 * (Math.random() - 0.5);
    const vx = deltaX + 6.67 * (Math.random() - 0.5);
    // AS: _loc2_.vy = this._y - yi + 6.67 * (Math.random() - 0.5);
    const vy = deltaY + 6.67 * (Math.random() - 0.5);
    
    // From DefineSprite_10_fumee/frame_1/DoAction.as
    const t = 50 * Math.random() + 50; // 50-100% scale
    const startFrame = Math.floor(Math.random() * 30); // random(30)
    
    this.trailParticles.spawn({
      x: this.projectileX,
      y: this.projectileY,
      vx: vx / (3 + 3 * Math.random()), // AS: vx /= 3 + 3 * Math.random()
      vy: vy / (3 + Math.floor(Math.random() * 3)), // AS: vy /= 3 + random(3)
      t: t,
      vt: 0,
      vtDecay: 0,
      accX: 1 / 1.2, // AS: vx /= 1.2 each frame
      accY: 1 / 1.2, // AS: vy /= 1.2 each frame
      rotation: startFrame * (360 / 30), // Convert frame to rotation
    });
    
    this.trailParticleCount++;
  }

  private updateBurstParticles(): void {
    // Custom physics for burst particles (ground collision)
    for (const particle of (this.burstParticles as any).particles) {
      if (!particle.alive) continue;
      
      const groundY = (particle as any).groundY;
      
      // Check ground collision (AS: if(_Y > yi))
      if (particle.y > groundY) {
        // AS: vy = (- vy) / 2; (bounce with 50% energy loss)
        particle.vy = -particle.vy / 2;
        // AS: vx *= 0.7; (30% horizontal friction)
        particle.vx *= 0.7;
        // AS: _Y = yi; (snap to ground)
        particle.y = groundY;
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Convert deltaTime to frames (20 FPS from manifest)
    const frameDelta = (deltaTime / 1000) * 20;
    this.elapsedFrames += frameDelta;

    // Move projectile toward target
    if (this.elapsedFrames < 73) {
      // Update previous position
      this.xi = this.projectileX;
      this.yi = this.projectileY;
      
      // Move projectile
      const progress = Math.min(1, this.elapsedFrames / 73);
      this.projectileX = this.init.targetX * progress;
      this.projectileY = this.init.targetY * progress;
      
      this.moveSprite.position.set(this.projectileX, this.projectileY);
      this.projectileContainer.position.set(this.projectileX, 0);
      
      // Rotate elements (AS: _rotation += 50)
      for (const element of this.rotatingElements) {
        element.rotation += (this.ROTATION_SPEED * Math.PI / 180) * frameDelta;
      }
      
      // Spawn trail particles
      this.trailSpawnAccumulator += this.TRAIL_SPAWN_RATE * frameDelta;
      while (this.trailSpawnAccumulator >= 1) {
        this.spawnTrailParticle();
        this.trailSpawnAccumulator -= 1;
      }
    }

    // Update particle systems
    this.burstParticles.update();
    this.updateBurstParticles(); // Custom physics for ground collision
    this.trailParticles.update();

    // Destroy particles at their frame limits
    if (this.elapsedFrames >= 46 && this.trailParticleCount > 0) {
      // Trail particles self-destruct at frame 46
      for (const particle of (this.trailParticles as any).particles) {
        particle.alive = false;
        particle.sprite.visible = false;
      }
      this.trailParticleCount = 0;
    }
    
    if (this.elapsedFrames >= 64 && this.burstParticleCount > 0) {
      // Burst particles self-destruct at frame 64
      for (const particle of (this.burstParticles as any).particles) {
        particle.alive = false;
        particle.sprite.visible = false;
      }
      this.burstParticleCount = 0;
    }

    // Complete at frame 73
    if (this.elapsedFrames >= 73) {
      this.complete();
    }
  }

  destroy(): void {
    this.burstParticles?.destroy();
    this.trailParticles?.destroy();
    super.destroy();
  }
}