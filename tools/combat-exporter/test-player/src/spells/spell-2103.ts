import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

/**
 * Spell 2103
 *
 * Particle burst effect that spawns circles at source which grow/shrink while moving outward,
 * followed by a hit effect at the target.
 *
 * Components:
 * - sprite_19: Source sprite that spawns particle effects at frame 7
 * - sprite_33: Target sprite that signals hit at frame 13
 * - cercle: Particle sprites with physics-based movement
 *
 * Original AS timing:
 * - Frame 2: Sound "jet_903"
 * - Frame 7: Spawn particles
 * - Frame 13: Signal hit
 * - Frame 67: Target sprite removed
 * - Frame 70: Source sprite stops
 */
export class Spell2103 extends BaseSpell {
  readonly spellId = 2103;

  private sourceAnim!: FrameAnimatedSprite;
  private targetAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const level = context.level;

    // Get manifests for anchor calculation
    const sourceManifest: SpriteManifest = {
      id: 19,
      name: 'sprite_19',
      frameCount: 72,
      width: 1028.1,
      height: 168,
      offsetX: 0,
      offsetY: 0,
      stopAt: 69,
      fadeAt: 68,
      composite: true,
    };

    const targetManifest: SpriteManifest = {
      id: 33,
      name: 'sprite_33',
      frameCount: 84,
      width: 1344.9,
      height: 529.5,
      offsetX: 0,
      offsetY: 0,
      stopAt: 83,
      fadeAt: 0,
      composite: false,
    };

    // Create particle system with cercle texture
    const particleTexture = textures.getFrames('lib_cercle')[0] ?? Texture.EMPTY;
    this.particles = new ASParticleSystem(particleTexture);
    this.container.addChildAt(this.particles, 0);

    // Create source animation at caster position
    this.sourceAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('sprite_19'),
        loop: false,
        animationSpeed: 1,
        anchor: calculateAnchor(sourceManifest),
      })
        .onFrame(1, () => this.callbacks.playSound('jet_903'))
        .onFrame(6, () => this.spawnParticles(level))
        .stopAt(69),
    );

    this.sourceAnim.scale.set(init.scale);
    this.sourceAnim.rotation = init.angleRad;
    this.sourceAnim.position.set(0, init.casterY);

    // Create target animation at target position
    this.targetAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('sprite_33'),
        loop: false,
        animationSpeed: 1,
        anchor: calculateAnchor(targetManifest),
      })
        .onFrame(12, () => this.signalHit())
        .onFrame(66, () => {
          this.targetAnim.visible = false;
        }),
    );

    this.targetAnim.scale.set(init.scale);
    this.targetAnim.rotation = init.angleRad;
    this.targetAnim.position.set(init.targetX, init.targetY);

    // Add animations to container
    this.container.addChild(this.sourceAnim);
    this.container.addChild(this.targetAnim);
  }

  private spawnParticles(level: number): void {
    // AS: nb = 10 + _parent.level * 3;
    const count = 10 + level * 3;

    // AS: d = 120 + (_parent._parent._parent.level - 1) * 32
    const d = 120 + (level - 1) * 32;

    this.particles.spawnMany(count, () => {
      // AS: accx = 0.8 + 0.12 * Math.random()
      const accX = 0.8 + 0.12 * Math.random();

      // AS: x = d * Math.random()
      const x = d * Math.random();

      // AS: 25% chance of y=5, 75% chance of y=-5
      let y: number;
      let sr: number;
      if (Math.floor(Math.random() * 4) === 0) {
        y = 5;
        sr = -1;
      } else {
        y = -5;
        sr = 1;
      }

      // AS: vr = (20 + 40 * Math.random()) * sr
      const vr = (20 + 40 * Math.random()) * sr;

      // AS: vt = (1 + random(1)) * ((d - x) / d)
      const vt = (1 + Math.floor(Math.random() * 1)) * ((d - x) / d);

      // AS: vx = 5 + 10 * Math.random()
      const vx = 5 + 10 * Math.random();

      return {
        x: x,
        y: y,
        vx: vx,
        accX: accX,
        vr: vr,
        vrDecay: 0.97,
        t: 5,
        vt: vt,
        vtDecay: 0.1,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);
    this.particles.update(deltaTime);

    // Check completion when target animation is complete and no particles remain
    if (this.targetAnim.isComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}