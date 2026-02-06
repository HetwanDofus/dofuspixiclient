/**
 * Spell 2049 - Bulbille
 *
 * A nature-themed projectile spell that launches from caster to target with bubble particles on impact.
 *
 * Components:
 * - sprite_4: Small animation at caster position (54 frames)
 * - sprite_9: Horizontal animation (27 frames)
 * - sprite_10: Main projectile at caster position, angled toward target (48 frames)
 * - sprite_11: Impact animation at target position (135 frames)
 * - bulle: Bubble particles spawned on impact (6 instances)
 *
 * Original AS timing:
 * - Frame 0: Play "herbe" sound
 * - Frame 1: Play "jet_903" sound
 * - Frame 70: Play "coquille" sound, spawn 6 bubbles, signal hit (this.end())
 * - Frame 133: Remove spell entirely
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

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 1429.8,
  height: 300.3,
  offsetX: -1416.9,
  offsetY: -149.4,
};

export class Spell2049 extends BaseSpell {
  readonly spellId = 2049;

  private sprite4!: FrameAnimatedSprite;
  private sprite9!: FrameAnimatedSprite;
  private sprite10!: FrameAnimatedSprite;
  private sprite11!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const sprite4Frames = textures.getFrames('sprite_4');
    const sprite9Frames = textures.getFrames('sprite_9');
    const sprite10Frames = textures.getFrames('sprite_10');
    const sprite11Frames = textures.getFrames('sprite_11');
    const bubbleTexture = textures.getFrames('lib_bulle')[0];

    this.particles = new ASParticleSystem(bubbleTexture);
    this.container.addChild(this.particles.container);

    const casterX = context.cellFrom?.x ?? 0;
    const casterY = (context.cellFrom?.y ?? 0) - 25;
    const targetX = context.cellTo?.x ?? 0;
    const targetY = (context.cellTo?.y ?? 0) - 10;

    const dx = targetX - casterX;
    const dy = targetY + 10 - casterY + 25;
    const angle = Math.atan2(dy, dx) * 180 / 3.1415;

    this.sprite4 = this.anims.add(new FrameAnimatedSprite({
      frames: sprite4Frames,
      manifest: SPRITE_4_MANIFEST,
      scale: init.scale,
      position: { x: casterX, y: casterY + 25 },
      anchor: calculateAnchor(SPRITE_4_MANIFEST),
      fps: 60,
      stopAt: 51,
    }));

    this.sprite9 = this.anims.add(new FrameAnimatedSprite({
      frames: sprite9Frames,
      manifest: SPRITE_9_MANIFEST,
      scale: init.scale,
      position: { x: 0, y: 0 },
      anchor: calculateAnchor(SPRITE_9_MANIFEST),
      fps: 60,
      stopAt: 24,
    }));

    this.sprite10 = this.anims.add(new FrameAnimatedSprite({
      frames: sprite10Frames,
      manifest: SPRITE_10_MANIFEST,
      scale: init.scale,
      position: { x: casterX, y: casterY },
      anchor: calculateAnchor(SPRITE_10_MANIFEST),
      fps: 60,
      stopAt: 45,
    }));
    this.sprite10.rotation = angle * Math.PI / 180;

    this.sprite11 = this.anims.add(new FrameAnimatedSprite({
      frames: sprite11Frames,
      manifest: SPRITE_11_MANIFEST,
      scale: init.scale,
      position: { x: targetX, y: targetY },
      anchor: calculateAnchor(SPRITE_11_MANIFEST),
      fps: 60,
    }));
    this.sprite11.rotation = angle * Math.PI / 180;

    this.sprite11
      .onFrame(69, () => {
        this.callbacks.playSound('coquille');

        for (let c = 0; c < 6; c++) {
          const rx = 0.7 + 0.15 * Math.random();
          const ry = 0.8 + 0.15 * Math.random();
          const vx = 20 + Math.floor(Math.random() * 25);
          const vy = -15 + Math.floor(Math.random() * 30);
          const alpha = (Math.floor(Math.random() * 50) + 50) / 100;
          const startFrame = Math.floor(Math.random() * 15);

          this.particles.spawn({
            x: 0,
            y: 0,
            vx,
            vy,
            accX: rx,
            accY: ry,
            alpha,
            frame: startFrame,
            t: 1000,
            vt: -1,
          });
        }

        this.signalHit();
      })
      .onFrame(132, () => {
        this.complete();
      });

    this.callbacks.playSound('herbe');

    this.sprite10.onFrame(0, () => {
      this.callbacks.playSound('jet_903');
    });

    this.container.addChild(
      this.sprite4,
      this.sprite9,
      this.sprite10,
      this.sprite11
    );
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update(deltaTime);

    if (this.anims.allComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}