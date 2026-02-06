/**
 * Spell 2065 - Unknown spell with bubble effects
 *
 * A spell with launch, projectile, and impact animations that spawns bubble particles.
 *
 * Components:
 * - sprite_4: Visual effect (54 frames, stops at 52)
 * - sprite_9: Visual effect (27 frames, stops at 25)
 * - sprite_10: Launch animation at caster position
 * - sprite_11: Projectile/impact animation at target position
 * - bulle: Bubble particles spawned at frame 70 of sprite_11
 *
 * Original AS timing:
 * - Frame 1: Play "jet_903" sound
 * - Frame 1 (sprite_10): Play "boo_up" sound, position at caster -25px Y
 * - Frame 46 (sprite_10): Stop animation
 * - Frame 1 (sprite_11): Position at target -30px Y with angle rotation
 * - Frame 70 (sprite_11): Spawn 6 bubbles and signal hit (this.end())
 * - Frame 133 (sprite_11): Remove parent movieclip
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
  height: 128.1,
  offsetX: -69.3,
  offsetY: -62.1,
};

const SPRITE_9_MANIFEST: SpriteManifest = {
  width: 1293,
  height: 225.6,
  offsetX: -282.6,
  offsetY: -112.8,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 1293,
  height: 434.7,
  offsetX: -288.6,
  offsetY: -360,
};

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 1431,
  height: 300.3,
  offsetX: -1416.9,
  offsetY: -149.4,
};

const BUBBLE_MANIFEST: SpriteManifest = {
  width: 168,
  height: 183.9,
  offsetX: -99.6,
  offsetY: -89.1,
};

export class Spell2065 extends BaseSpell {
  readonly spellId = 2065;

  private sprite4Anim!: FrameAnimatedSprite;
  private sprite9Anim!: FrameAnimatedSprite;
  private sprite10Anim!: FrameAnimatedSprite;
  private sprite11Anim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;
  private bubblesSpawned = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play initial sound
    this.callbacks.playSound('jet_903');

    // Sprite 4 animation
    this.sprite4Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_4'),
      ...calculateAnchor(SPRITE_4_MANIFEST),
      scale: init.scale,
    }));
    this.sprite4Anim.stopAt(51);
    this.container.addChild(this.sprite4Anim.sprite);

    // Sprite 9 animation
    this.sprite9Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      ...calculateAnchor(SPRITE_9_MANIFEST),
      scale: init.scale,
    }));
    this.sprite9Anim.stopAt(24);
    this.container.addChild(this.sprite9Anim.sprite);

    // Sprite 10 (launch animation at caster)
    this.sprite10Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      ...calculateAnchor(SPRITE_10_MANIFEST),
      scale: init.scale,
    }));
    // AS: _parent.cellFrom.x, _parent.cellFrom.y - 25
    this.sprite10Anim.sprite.position.set(0, -25);
    this.sprite10Anim.sprite.rotation = init.angleRad;
    this.sprite10Anim
      .stopAt(45)
      .onFrame(0, () => this.callbacks.playSound('boo_up'));
    this.container.addChild(this.sprite10Anim.sprite);

    // Sprite 11 (projectile/impact at target)
    this.sprite11Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_11'),
      ...calculateAnchor(SPRITE_11_MANIFEST),
      scale: init.scale,
    }));
    // AS: _parent.cellTo.x, _parent.cellTo.y - 30
    this.sprite11Anim.sprite.position.set(init.targetX, init.targetY - 30 + init.casterY);
    this.sprite11Anim.sprite.rotation = init.angleRad;
    this.sprite11Anim
      .onFrame(69, () => this.spawnBubbles(textures, init))
      .onFrame(132, () => this.complete());
    this.container.addChild(this.sprite11Anim.sprite);

    // Initialize particle system
    const bubbleTexture = textures.getFrames('lib_bulle')[0] ?? Texture.EMPTY;
    this.particles = new ASParticleSystem(bubbleTexture);
    this.particles.container.position.set(init.targetX, init.targetY - 30 + init.casterY);
    this.container.addChildAt(this.particles.container, 0);
  }

  private spawnBubbles(textures: SpellTextureProvider, init: SpellInitContext): void {
    if (this.bubblesSpawned) {
      return;
    }
    this.bubblesSpawned = true;

    // Signal hit when bubbles spawn
    this.signalHit();

    // Spawn 6 bubbles as per AS
    for (let i = 1; i <= 6; i++) {
      // AS bubble physics from DefineSprite_5_bulle/frame_1/DoAction.as
      const rx = 0.7 + Math.random() * 0.15;
      const ry = 0.8 + Math.random() * 0.15;
      const vx = 20 + Math.random() * 24;
      const vy = -15 + Math.random() * 29;
      const alpha = 0.5 + Math.random() * 0.5;

      const particle = this.particles.spawn({
        x: 0,
        y: 0,
        vx: vx,
        vy: vy,
        accX: rx,
        accY: ry,
        alpha: alpha,
        t: 100,
        vt: 0,
        vtDecay: 0,
      });

      // Random start frame (1-10 in AS, 0-9 in TS)
      const randomFrame = Math.floor(Math.random() * 10);
      if (particle.sprite.texture instanceof Texture) {
        particle.sprite.texture.frame.x = randomFrame * BUBBLE_MANIFEST.width;
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    // Complete when sprite 11 is done and no particles remain
    if (this.anims.allComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}