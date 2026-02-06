/**
 * Spell 112 - Bulle
 *
 * A spell that creates a bubble effect traveling from caster to target with particle effects.
 *
 * Components:
 * - sprite_4: Caster animation at caster position
 * - sprite_10: Animation at caster position with Y offset -80, rotated toward target
 * - sprite_9: Animation that inherits rotation from sprite_10
 * - sprite_11: Impact animation at target position with Y offset -10
 * - bulle particles: 6 bubble particles spawned at frame 70 of sprite_11
 *
 * Original AS timing:
 * - Frame 1 (sprite_10): Play "herbe" sound, calculate angle to target
 * - Frame 2 (main): Play "jet_903" sound
 * - Frame 46 (sprite_10): sprite_9 inherits rotation
 * - Frame 70 (sprite_11): Play "coquille" sound, spawn particles, signal hit
 * - Frame 133 (sprite_11): Remove animation
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

const SPRITE_4_MANIFEST: SpriteManifest = {
  width: 117,
  height: 128.10000000000002,
  offsetX: -69.30000000000001,
  offsetY: -62.099999999999994,
};

const SPRITE_9_MANIFEST: SpriteManifest = {
  width: 1367.1,
  height: 293.1,
  offsetX: -291.29999999999995,
  offsetY: -148.5,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 1367.1,
  height: 786.9000000000001,
  offsetX: -297.29999999999995,
  offsetY: -738,
};

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 1503.3000000000002,
  height: 300.29999999999995,
  offsetX: -1416.9,
  offsetY: -149.39999999999998,
};

export class Spell112 extends BaseSpell {
  readonly spellId = 112;

  private sprite4Anim!: FrameAnimatedSprite;
  private sprite9Anim!: FrameAnimatedSprite;
  private sprite10Anim!: FrameAnimatedSprite;
  private sprite11Anim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // sprite_4 at caster position
    this.sprite4Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_4'),
      ...calculateAnchor(SPRITE_4_MANIFEST),
      scale: init.scale,
    }));
    this.sprite4Anim.sprite.position.set(0, init.casterY);
    this.sprite4Anim.stopAt(51);
    this.container.addChild(this.sprite4Anim.sprite);

    // Calculate angle for sprite_10
    const dx = init.targetX;
    const dy = init.targetY + 10 - init.casterY + 80;
    const angle = Math.atan2(dy, dx);

    // sprite_10 at caster position with Y offset -80
    this.sprite10Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      ...calculateAnchor(SPRITE_10_MANIFEST),
      scale: init.scale,
    }));
    this.sprite10Anim.sprite.position.set(0, init.casterY - 80);
    this.sprite10Anim.sprite.rotation = 0;
    this.sprite10Anim
      .stopAt(45)
      .onFrame(0, () => this.callbacks.playSound('herbe'));
    this.container.addChild(this.sprite10Anim.sprite);

    // sprite_9 inherits rotation from angle
    this.sprite9Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      ...calculateAnchor(SPRITE_9_MANIFEST),
      scale: init.scale,
      startFrame: 45,
    }));
    this.sprite9Anim.sprite.position.set(0, init.casterY - 80);
    this.sprite9Anim.sprite.rotation = angle;
    this.sprite9Anim.stopAt(24);
    this.sprite9Anim.sprite.visible = false;
    this.container.addChild(this.sprite9Anim.sprite);

    // Show sprite_9 when sprite_10 reaches frame 46
    this.sprite10Anim.onFrame(45, () => {
      this.sprite9Anim.sprite.visible = true;
    });

    // sprite_11 at target position with Y offset -10
    this.sprite11Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_11'),
      ...calculateAnchor(SPRITE_11_MANIFEST),
      scale: init.scale,
    }));
    this.sprite11Anim.sprite.position.set(init.targetX, init.targetY - 10);
    this.sprite11Anim.sprite.rotation = angle;
    this.sprite11Anim
      .onFrame(69, () => {
        this.callbacks.playSound('coquille');
        this.spawnBubbles();
        this.signalHit();
      });
    this.container.addChild(this.sprite11Anim.sprite);

    // Particle system for bubbles
    const bubbleTexture = textures.getFrames('lib_bulle')[0] ?? Texture.EMPTY;
    this.particles = new ASParticleSystem(bubbleTexture);
    this.particles.container.position.set(init.targetX, init.targetY - 10);
    this.container.addChild(this.particles.container);

    // Play main timeline sound
    this.callbacks.playSound('jet_903');
  }

  private spawnBubbles(): void {
    // Spawn 6 bubbles as per AS code
    for (let c = 1; c < 7; c++) {
      const rx = 0.7 + 0.15 * Math.random();
      const ry = 0.8 + 0.15 * Math.random();
      const vx = 20 + Math.floor(Math.random() * 25);
      const vy = -15 + Math.floor(Math.random() * 30);
      const alpha = (Math.floor(Math.random() * 50) + 50) / 100;
      
      // Random frame start (1-5 in AS, 0-4 in TS)
      const startFrame = Math.floor(Math.random() * 5);

      this.particles.spawn({
        x: 0,
        y: 0,
        vx: vx,
        vy: vy,
        accX: rx,
        accY: ry,
        alpha: alpha,
        frame: startFrame,
      });
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    // Complete when all animations are done and no particles are alive
    if (this.anims.allComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}