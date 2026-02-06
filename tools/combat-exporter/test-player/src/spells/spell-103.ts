/**
 * Spell 103 - Ronce
 *
 * A thorny projectile spell that creates oscillating spikes.
 *
 * Components:
 * - move sprite: Spawns "baton" particles that drift with decay
 * - shoot sprite: Spawns oscillating "baton2" spikes
 * - effet sprite: Impact animation at target
 *
 * Original AS timing:
 * - Frame 1: Play "ronce" sound
 * - Frame 1: Spawn 2 + level * level * 0.7 particles
 * - Frame 2: Attach effect animation
 * - Frame 16: Effect animation ends
 * - Frame 106: Shoot animation ends, spell complete
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

interface BatonParticle {
  sprite: FrameAnimatedSprite;
  v: number;
  vy: number;
}

interface Baton2Particle {
  sprite: FrameAnimatedSprite;
  a: number;
  i: number;
  v2: number;
}

const EFFET_MANIFEST: SpriteManifest = {
  width: 604.8,
  height: 605.0999999999999,
  offsetX: -296.1,
  offsetY: -302.70000000000005,
};

export class Spell103 extends BaseSpell {
  readonly spellId = 103;

  private moveSprite!: FrameAnimatedSprite;
  private shootSprite!: FrameAnimatedSprite;
  private effetAnim!: FrameAnimatedSprite;
  private batonParticles: BatonParticle[] = [];
  private baton2Particles: Baton2Particle[] = [];
  private level = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Play sound at frame 1 (0-indexed: frame 0)
    this.callbacks.playSound('ronce');

    // Move sprite - invisible container for baton particles
    this.moveSprite = this.anims.add(new FrameAnimatedSprite({
      textures: [Texture.EMPTY],
      scale: init.scale,
      stopFrame: 1,
    }));
    this.moveSprite.sprite.position.set(0, init.casterY);
    this.moveSprite
      .onFrame(0, () => this.spawnBatonParticles(textures, init))
      .onFrame(1, () => this.attachEffet(textures, init));
    this.container.addChild(this.moveSprite.sprite);

    // Shoot sprite - invisible container for baton2 particles
    this.shootSprite = this.anims.add(new FrameAnimatedSprite({
      textures: Array(106).fill(Texture.EMPTY),
      scale: init.scale,
    }));
    this.shootSprite.sprite.position.set(0, init.casterY);
    this.shootSprite.sprite.rotation = init.angleRad;
    this.shootSprite.onFrame(0, () => this.spawnBaton2Particles(textures, init));
    this.container.addChild(this.shootSprite.sprite);
  }

  private spawnBatonParticles(textures: SpellTextureProvider, init: SpellInitContext): void {
    const batonFrames = textures.getFrames('lib_baton');
    const count = Math.floor(2 + this.level * this.level * 0.7);

    for (let c = 0; c < count; c++) {
      const batonSprite = new FrameAnimatedSprite({
        textures: batonFrames,
        scale: init.scale,
        anchorX: 0.5,
        anchorY: 0.5,
      });

      // AS: v = 1.6 * (-0.5 + Math.random())
      const v = 1.6 * (-0.5 + Math.random());
      // AS: vy = 3 * (-0.5 + Math.random())
      const vy = 3 * (-0.5 + Math.random());
      // AS: t = 50 + 40 * (-0.5 + Math.random())
      const t = 50 + 40 * (-0.5 + Math.random());

      // AS: _yscale = t + 5; _xscale = t + 5
      const scaleValue = (t + 5) / 100;
      batonSprite.sprite.scale.set(scaleValue, scaleValue);

      this.moveSprite.sprite.addChild(batonSprite.sprite);
      this.batonParticles.push({ sprite: batonSprite, v, vy });
    }
  }

  private spawnBaton2Particles(textures: SpellTextureProvider, init: SpellInitContext): void {
    const baton2Frames = textures.getFrames('lib_baton2');
    const count = Math.floor(2 + this.level * this.level * 0.7);

    for (let c = 0; c < count; c++) {
      const baton2Sprite = new FrameAnimatedSprite({
        textures: baton2Frames,
        scale: init.scale,
        anchorX: 0.5,
        anchorY: 0.5,
      });

      // AS baton2 frame 1: t = 100 - random(50)
      const t = 100 - Math.floor(Math.random() * 50);
      const scaleValue = t / 100;
      baton2Sprite.sprite.scale.set(scaleValue, scaleValue);

      // AS: _X = 40 * (0.5 - Math.random())
      baton2Sprite.sprite.x = 40 * (0.5 - Math.random());
      // AS: _Y = 20 * (0.5 - Math.random())
      baton2Sprite.sprite.y = 20 * (0.5 - Math.random());

      // AS onLoad: a = 10 + random(20)
      const a = 10 + Math.floor(Math.random() * 20);
      // AS: i = 6 * Math.random()
      const i = 6 * Math.random();
      // AS: v2 = 1.05 + 0.5 * Math.random()
      const v2 = 1.05 + 0.5 * Math.random();

      this.shootSprite.sprite.addChild(baton2Sprite.sprite);
      this.baton2Particles.push({ sprite: baton2Sprite, a, i, v2 });
    }
  }

  private attachEffet(textures: SpellTextureProvider, init: SpellInitContext): void {
    // AS: _parent.attachMovie("effet","effet",100)
    const effetAnchor = calculateAnchor(EFFET_MANIFEST);
    this.effetAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('effet'),
      anchorX: effetAnchor.x,
      anchorY: effetAnchor.y,
      scale: init.scale,
      stopFrame: 15,
    }));
    this.effetAnim.sprite.position.set(init.targetX, init.targetY);
    this.effetAnim.onFrame(15, () => this.signalHit());
    this.container.addChild(this.effetAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all registered animations
    this.anims.update(deltaTime);

    // Update baton particles physics
    for (const particle of this.batonParticles) {
      // AS: _X = _X + v; _Y = _Y + vy
      particle.sprite.sprite.x += particle.v;
      particle.sprite.sprite.y += particle.vy;
      // AS: v *= 0.95; vy *= 0.95
      particle.v *= 0.95;
      particle.vy *= 0.95;
    }

    // Update baton2 particles rotation
    for (const particle of this.baton2Particles) {
      // AS: _rotation = a * Math.sin(i++)
      particle.sprite.sprite.rotation = (particle.a * Math.sin(particle.i) * Math.PI) / 180;
      particle.i += 1;
      // AS: a /= v2
      particle.a /= particle.v2;
    }

    // Check completion - shoot animation reaches frame 106
    if (this.shootSprite.getFrame() >= 105) {
      this.complete();
    }
  }

  destroy(): void {
    this.batonParticles = [];
    this.baton2Particles = [];
    super.destroy();
  }
}