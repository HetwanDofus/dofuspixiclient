/**
 * Spell 209 - Rock Storm
 *
 * Multi-hit earth spell with falling stones that spawn at different frames.
 *
 * Components:
 * - anim1: Main animation with 174 frames
 * - pierres: Stone particles that spawn at multiple frames and positions
 *
 * Original AS timing:
 * - Frame 49: Play sound "grrr1"
 * - Frame 55: Spawn 5 stones
 * - Frame 64: Play sound "grrr2" + spawn 15 stones (3 positions × 5)
 * - Frame 70: Spawn 5 stones
 * - Frame 76: Spawn 5 stones
 * - Frame 124: Hit signal (this.end())
 * - Frame 148: Start fade out (alpha - 10 per frame)
 * - Frame 172: Complete and remove
 */

import { Texture, Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import { FrameAnimatedSprite, ASParticleSystem, calculateAnchor } from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

interface StoneParticle {
  sprite: Container;
  vx: number;
  vy: number;
  v: number;
  vr: number;
  t: number;
  fadingOut?: boolean;
}

export class Spell209 extends BaseSpell {
  readonly spellId = 209;

  private mainAnim!: FrameAnimatedSprite;
  private particleTexture!: Texture;
  private particles: StoneParticle[] = [];

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.particleTexture = textures.getFrames('lib_pierres')[0];

    const manifest = textures.getManifest('anim1');
    const frames = textures.getFrames('anim1');
    const anim1Anchor = calculateAnchor(manifest);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      scale: init.scale,
      stopFrame: 171,
    }));

    this.mainAnim.sprite.position.set(0, init.casterY);
    this.container.addChild(this.mainAnim.sprite);

    this.mainAnim
      .onFrame(48, () => this.callbacks.playSound('grrr1'))
      .onFrame(54, () => this.spawnStones(0, 0, 5))
      .onFrame(63, () => {
        this.callbacks.playSound('grrr2');
        this.spawnStones(-50, 0, 5);
        this.spawnStones(0, 0, 5);
        this.spawnStones(50, 0, 5);
      })
      .onFrame(69, () => this.spawnStones(25, -25, 5))
      .onFrame(75, () => this.spawnStones(-25, -25, 5))
      .onFrame(123, () => this.signalHit())
      .onFrame(147, () => this.startFadeOut());
  }

  private spawnStones(baseX: number, baseY: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const container = new Container();
      const sprite = new Container();

      const stoneSprite = new FrameAnimatedSprite({
        textures: [this.particleTexture],
        anchorX: 0.5,
        anchorY: 0.5,
      });
      
      sprite.addChild(stoneSprite.sprite);
      container.addChild(sprite);
      
      const vx = 5 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);
      container.x = baseX + 20 * (Math.random() - 0.5);
      container.y = baseY + 10 * (Math.random() - 0.5);
      const t = 60 + 40 * Math.random();
      sprite.scale.x = t / 100;
      sprite.scale.y = t / 100;
      sprite.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
      const v = -10 * Math.random() - 3;
      const vr = 40 * (-0.5 + Math.random());

      this.container.addChild(container);
      
      this.particles.push({
        sprite: container,
        vx,
        vy,
        v,
        vr,
        t,
      });
    }
  }

  private startFadeOut(): void {
    this.mainAnim.sprite.alpha = 1;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    for (const particle of this.particles) {
      particle.sprite.x += particle.vx;
      particle.sprite.y += particle.vy;
      
      if (particle.t !== 1) {
        const innerSprite = particle.sprite.children[0];
        innerSprite.y += particle.v;
        innerSprite.rotation += (particle.vr * Math.PI) / 180;
        particle.v += 0.5;
        
        if (innerSprite.y > 0) {
          particle.vx /= 2;
          particle.vy /= 2;
          innerSprite.rotation = 0;
          innerSprite.y = 0;
          particle.v = -particle.v / 4;
          
          if (Math.abs(particle.v) < 1) {
            particle.vx = 0;
            particle.vy = 0;
            particle.t = 1;
          }
        }
      }
    }

    if (this.mainAnim.getFrame() >= 147 && this.mainAnim.getFrame() < 171) {
      this.mainAnim.sprite.alpha -= 10 / 100;
      if (this.mainAnim.sprite.alpha < 0) {
        this.mainAnim.sprite.alpha = 0;
      }
    }

    if (this.mainAnim.getFrame() >= 171) {
      this.complete();
    }
  }

  destroy(): void {
    for (const particle of this.particles) {
      particle.sprite.destroy({ children: true });
    }
    this.particles = [];
    super.destroy();
  }
}