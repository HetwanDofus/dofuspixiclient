/**
 * Spell 2018 - Smoke Bomb
 *
 * Projectile that spawns smoke particles with gravity physics and ground collision.
 *
 * Components:
 * - move: Main projectile animation
 * - fumee2: Smoke particles spawned at start, fall with gravity
 *
 * Original AS timing:
 * - Frame 1: Spawn 7 smoke particles
 * - Frame 106: Spell ends
 * - Smoke particles: 55 frames lifetime, ground collision triggers dissipation
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const MOVE_MANIFEST: SpriteManifest = {
  width: 93,
  height: 31.8,
  offsetX: -58.2,
  offsetY: -16.2,
};

const SMOKE_MANIFEST: SpriteManifest = {
  width: 21.6,
  height: 21.6,
  offsetX: -9.6,
  offsetY: -12.3,
};

interface SmokeParticle {
  sprite: FrameAnimatedSprite;
  vx: number;
  vy: number;
  vr: number;
  t: number;
  vt: number;
  yi: number;
  fin: number;
  a: number;
  grounded: boolean;
}

export class Spell2018 extends BaseSpell {
  readonly spellId = 2018;

  private moveAnim!: FrameAnimatedSprite;
  private smokeParticles: SmokeParticle[] = [];
  private smokeContainer!: Container;
  private completionTimer = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Create smoke container
    this.smokeContainer = new Container();
    this.container.addChild(this.smokeContainer);

    // Main projectile animation
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      ...calculateAnchor(MOVE_MANIFEST),
      scale: init.scale,
    }));
    this.moveAnim.sprite.position.set(0, init.casterY);
    this.moveAnim.sprite.rotation = init.angleRad;
    this.moveAnim
      .loopBetween(0, 5)
      .onFrame(0, () => this.spawnSmokes(textures, init));
    this.container.addChild(this.moveAnim.sprite);
  }

  private spawnSmokes(textures: SpellTextureProvider, init: SpellInitContext): void {
    const smokeFrames = textures.getFrames('lib_fumee2');
    
    for (let c = 0; c < 7; c++) {
      // Create smoke animation sprite
      const smokeAnim = new FrameAnimatedSprite({
        textures: smokeFrames,
        ...calculateAnchor(SMOKE_MANIFEST),
        scale: init.scale,
      });

      // AS: t = 50 * Math.random() + 50
      const t = 50 * Math.random() + 50;
      
      // AS: vx = (Math.random() * 5 - 2.5)
      const vx = Math.random() * 5 - 2.5;
      
      // AS: vy = -5 * Math.random()
      const vy = -5 * Math.random();
      
      // AS: vr = Math.random() * 30 - 15
      const vr = Math.random() * 30 - 15;
      
      // AS: yi = _Y - 5 + 10 * Math.random()
      const yi = init.casterY - 5 + 10 * Math.random();

      // Apply initial scale
      smokeAnim.sprite.scale.set(t * init.scale / 100);
      smokeAnim.sprite.position.set(0, init.casterY);

      const particle: SmokeParticle = {
        sprite: smokeAnim,
        vx: vx,
        vy: vy * 2, // AS: vy *= 2 in frame 1
        vr: vr,
        t: t,
        vt: 1,
        yi: yi,
        fin: 0,
        a: 0,
        grounded: false
      };

      this.smokeParticles.push(particle);
      this.smokeContainer.addChild(smokeAnim.sprite);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update main animation
    this.anims.update(deltaTime);

    // Update smoke particles physics
    for (const particle of this.smokeParticles) {
      if (!particle.grounded) {
        // AS: vy += 0.5 (gravity)
        particle.vy += 0.5;
        
        // AS: _X += vx
        particle.sprite.sprite.x += particle.vx;
        
        // AS: _Y += vy
        particle.sprite.sprite.y += particle.vy;
        
        // AS: _rotation += vr
        particle.sprite.sprite.rotation += (particle.vr * Math.PI / 180);
        
        // AS: if (_Y > yi) - ground collision
        if (particle.sprite.sprite.y > particle.yi) {
          particle.sprite.sprite.y = particle.yi;
          particle.sprite.sprite.rotation = 0;
          particle.grounded = true;
          particle.fin = 1;
          
          // Start playing the animation when grounded
          particle.sprite.play();
        }
      } else {
        // Dissipation phase
        // AS: _alpha = 150 - (a += 3.3)
        particle.a += 3.3;
        particle.sprite.sprite.alpha = Math.max(0, (150 - particle.a) / 255);
        
        // AS: vt += 0.1; if (vt > 3) vt = 3;
        particle.vt += 0.1;
        if (particle.vt > 3) {
          particle.vt = 3;
        }
        
        // AS: _xscale = t * vt * 2; _yscale = t * vt;
        const baseScale = particle.t / 100;
        particle.sprite.sprite.scale.x = baseScale * particle.vt * 2 * (1 / 6);
        particle.sprite.sprite.scale.y = baseScale * particle.vt * (1 / 6);
      }

      // Update the smoke animation if playing
      if (particle.grounded) {
        particle.sprite.update(deltaTime);
      }
    }

    // Check for completion after 106 frames (2.65 seconds at 40fps)
    this.completionTimer += deltaTime;
    if (this.completionTimer >= 2650) {
      this.signalHit();
      this.complete();
    }
  }

  destroy(): void {
    for (const particle of this.smokeParticles) {
      particle.sprite.destroy();
    }
    this.smokeParticles = [];
    this.smokeContainer.destroy();
    super.destroy();
  }
}