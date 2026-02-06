/**
 * Spell 2013 - Bubble projectile
 *
 * A projectile effect that travels from caster to target with bubble burst on impact.
 *
 * Components:
 * - sprite_4: Support animation element
 * - sprite_9: Support animation element
 * - sprite_10: Origin effect at caster position (46 frames)
 * - sprite_11: Impact effect at target position (89 frames)
 * - bulle: Bubble particles that spawn on impact
 *
 * Original AS timing:
 * - Frame 1 (sprite_10): Play sound "boo_up"
 * - Frame 2 (main): Play sound "jet_903"
 * - Frame 47 (sprite_11): Spawn 6 bubbles, signal hit
 * - Frame 89 (sprite_11): Remove all visuals
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
  width: 1286.6999999999998,
  height: 220.20000000000002,
  offsetX: -282,
  offsetY: -110.10000000000001,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 1286.6999999999998,
  height: 376.5,
  offsetX: -288,
  offsetY: -360.29999999999995,
};

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 1424.6999999999998,
  height: 300.29999999999995,
  offsetX: -1416.9,
  offsetY: -149.39999999999998,
};

export class Spell2013 extends BaseSpell {
  readonly spellId = 2013;

  private sprite4!: FrameAnimatedSprite;
  private sprite9!: FrameAnimatedSprite;
  private originAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play main timeline sound
    this.callbacks.playSound('jet_903');

    // sprite_4 animation
    this.sprite4 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_4'),
      ...calculateAnchor(SPRITE_4_MANIFEST),
      scale: init.scale,
    }));
    this.sprite4.stopAt(50);
    this.container.addChild(this.sprite4.sprite);

    // sprite_9 animation
    this.sprite9 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      ...calculateAnchor(SPRITE_9_MANIFEST),
      scale: init.scale,
    }));
    this.sprite9.stopAt(15);
    this.container.addChild(this.sprite9.sprite);

    // sprite_10 (origin effect) at caster position
    this.originAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      ...calculateAnchor(SPRITE_10_MANIFEST),
      scale: init.scale,
    }));
    // AS: _x = _parent.cellFrom._x; _y = _parent.cellFrom._y - 25;
    this.originAnim.sprite.position.set(0, -25);
    this.originAnim.stopAt(44);
    this.originAnim.onFrame(0, () => this.callbacks.playSound('boo_up'));
    this.container.addChild(this.originAnim.sprite);

    // sprite_11 (impact effect) at target position
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_11'),
      ...calculateAnchor(SPRITE_11_MANIFEST),
      scale: init.scale,
    }));
    // AS: _x = _parent.cellTo._x; _y = _parent.cellTo._y - 30; _rotation = _parent.angle;
    this.impactAnim.sprite.position.set(init.targetX, init.targetY - 30);
    this.impactAnim.sprite.rotation = init.angleRad;
    this.impactAnim
      .onFrame(46, () => {
        this.spawnBubbles();
        this.signalHit();
      });
    this.container.addChild(this.impactAnim.sprite);

    // Particle system for bubbles
    const bubbleTexture = textures.getFrames('lib_bulle')[0] ?? Texture.EMPTY;
    this.particles = new ASParticleSystem(bubbleTexture);
    this.particles.container.position.set(init.targetX, init.targetY - 30);
    this.container.addChildAt(this.particles.container, 0);
  }

  private spawnBubbles(): void {
    // AS: for(c = 1; c < 7; c++) { attachMovie("bulle","bulle" + c,c); }
    for (let c = 1; c < 7; c++) {
      // From DefineSprite_5_bulle/frame_1/PlaceObject2_4_1/CLIPACTIONRECORD onClipEvent(load).as:
      // rx = 0.7 + 0.15 * Math.random();
      // ry = 0.8 + 0.15 * Math.random();
      // vx = 20 + random(25);
      // vy = -15 + random(30);
      // gotoAndPlay(random(15) + 2);
      // _alpha = random(50) + 50;
      const rx = 0.7 + 0.15 * Math.random();
      const ry = 0.8 + 0.15 * Math.random();
      const vx = 20 + Math.floor(Math.random() * 25);
      const vy = -15 + Math.floor(Math.random() * 30);
      const alpha = Math.floor(Math.random() * 50) + 50;

      // Spawn particle with exact AS physics
      // AS physics: _X = _X + (vx *= rx); _Y = _Y + (vy *= ry);
      this.particles.spawn({
        x: 0,
        y: 0,
        vx: vx,
        vy: vy,
        accX: rx,
        accY: ry,
        // Bubble texture already handles its own animation starting at random frame
        alpha: alpha / 100, // Convert to 0-1 range
      });
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    // Complete when impact animation is done and no particles are alive
    if (this.impactAnim.isComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}