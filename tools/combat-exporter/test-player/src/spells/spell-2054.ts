/**
 * Spell 2054 - Puissance Sylvestre
 *
 * A nature spell that creates growing vines/plants from caster to target.
 *
 * Components:
 * - sprite_10: Growing vine animation at caster
 * - sprite_9: Horizontal vine beam along path
 * - sprite_13: Impact animation at target
 * - sprite_12: Circular effect at target (placed at frame 24)
 * - sprite_4: Bubble particles
 *
 * Original AS timing:
 * - Frame 1: Play "herbe" sound (sprite_10)
 * - Frame 2: Play "jet_903" sound (main timeline)
 * - Frame 24: Signal hit and play "coquille" sound (sprite_13)
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
  width: 1292.4,
  height: 227.1,
  offsetX: -283.2,
  offsetY: -114.9,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 1292.4,
  height: 519.6,
  offsetX: -289.2,
  offsetY: -444.9,
};

const SPRITE_12_MANIFEST: SpriteManifest = {
  width: 767.4,
  height: 767.4,
  offsetX: -383.7,
  offsetY: -383.7,
};

const SPRITE_13_MANIFEST: SpriteManifest = {
  width: 1678.2,
  height: 300.3,
  offsetX: -1416.9,
  offsetY: -149.4,
};

export class Spell2054 extends BaseSpell {
  readonly spellId = 2054;

  private growthAnim!: FrameAnimatedSprite;
  private beamAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private circleAnim!: FrameAnimatedSprite;
  private bubbles!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Calculate angle for sprite_10 based on AS logic
    const dx = init.targetX;
    const dy = init.targetY - init.casterY + 25;
    const angleForSprite10 = Math.atan2(dy, dx);

    // Sprite 10 - Growing animation at caster
    this.growthAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      ...calculateAnchor(SPRITE_10_MANIFEST),
      scale: init.scale,
    }));
    this.growthAnim.sprite.position.set(0, init.casterY - 25);
    this.growthAnim.sprite.rotation = 0;
    this.growthAnim
      .stopAt(45)
      .onFrame(0, () => this.callbacks.playSound('herbe'));
    this.container.addChild(this.growthAnim.sprite);

    // Sprite 9 - Horizontal beam (placed inside sprite_10 at frame 46)
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      ...calculateAnchor(SPRITE_9_MANIFEST),
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(0, init.casterY - 25);
    this.beamAnim.sprite.rotation = angleForSprite10;
    this.beamAnim.sprite.visible = false;
    this.beamAnim.stopAt(24);
    this.growthAnim.onFrame(45, () => {
      this.beamAnim.sprite.visible = true;
    });
    this.container.addChild(this.beamAnim.sprite);

    // Sprite 13 - Impact animation at target
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_13'),
      ...calculateAnchor(SPRITE_13_MANIFEST),
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim.sprite.rotation = init.angleRad;
    this.impactAnim
      .onFrame(1, () => this.callbacks.playSound('jet_903'))
      .onFrame(23, () => {
        this.signalHit();
        this.callbacks.playSound('coquille');
        // Show circle animation
        this.circleAnim.sprite.visible = true;
      });
    this.container.addChild(this.impactAnim.sprite);

    // Sprite 12 - Circle effect (placed at frame 24 of sprite_13)
    this.circleAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_12'),
      ...calculateAnchor(SPRITE_12_MANIFEST),
      scale: init.scale,
    }));
    this.circleAnim.sprite.position.set(init.targetX, init.targetY);
    this.circleAnim.sprite.rotation = -init.angleRad;
    this.circleAnim.sprite.visible = false;
    this.circleAnim.stopAt(11);
    this.container.addChild(this.circleAnim.sprite);

    // Bubble particle system
    const bubbleTextures = textures.getFrames('sprite_4');
    this.bubbles = new ASParticleSystem(bubbleTextures[0] ?? Texture.EMPTY);
    
    // Setup bubble particles throughout the animation
    this.bubbles.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.bubbles.container);

    // Spawn bubbles at various points
    this.impactAnim.onFrame(0, () => this.spawnBubbles());
    this.impactAnim.onFrame(10, () => this.spawnBubbles());
    this.impactAnim.onFrame(20, () => this.spawnBubbles());
  }

  private spawnBubbles(): void {
    const count = 3 + Math.floor(Math.random() * 3);
    
    this.bubbles.spawnMany(count, () => {
      // From DefineSprite_5_bulle AS code
      const rx = 0.7 + 0.15 * Math.random();
      const ry = 0.8 + 0.15 * Math.random();
      const vx = 20 + Math.floor(Math.random() * 25);
      const vy = -15 + Math.floor(Math.random() * 30);
      const alpha = (Math.floor(Math.random() * 50) + 50) / 100;
      
      // Random starting frame (1-15 in AS, 0-14 in TS)
      const startFrame = Math.floor(Math.random() * 15);
      
      // Offset position slightly
      const x = -50 + Math.random() * 100;
      const y = -50 + Math.random() * 100;
      
      return {
        x,
        y,
        vx,
        vy,
        accX: rx,
        accY: ry,
        alpha,
        frame: startFrame,
        t: 52, // Total frames for sprite_4
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.bubbles.update();

    if (this.anims.allComplete() && !this.bubbles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.bubbles.destroy();
    super.destroy();
  }
}