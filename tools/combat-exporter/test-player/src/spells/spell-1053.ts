/**
 * Spell 1053 - Sacrieur Spell
 *
 * A spell that creates a continuous stream of fading spire particles that move horizontally.
 *
 * Components:
 * - shoot: Main animation (81 frames) with sound trigger
 * - move: Looping animation that spawns spire particles
 * - spire particles: Shrinking, fading particles that move left
 *
 * Original AS timing:
 * - Frame 4: Sound plays (sacrieur_1053)
 * - Frame 52: Main animation removes itself
 * - Move animation loops frames 4-7, spawning 2 particles per frame
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

const SHOOT_MANIFEST: SpriteManifest = {
  width: 904.5,
  height: 1177.2,
  offsetX: -432.3,
  offsetY: -829.2,
};

const MOVE_MANIFEST: SpriteManifest = {
  width: 293.4,
  height: 116.4,
  offsetX: -263.7,
  offsetY: -53.7,
};

export class Spell1053 extends BaseSpell {
  readonly spellId = 1053;

  private shootAnim!: FrameAnimatedSprite;
  private moveAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;
  private particleCounter = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main shoot animation
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim
      .onFrame(3, () => this.callbacks.playSound('sacrieur_1053'))
      .onFrame(51, () => {
        // Frame 52 in AS (1-indexed) removes parent
        this.shootAnim.sprite.visible = false;
      });
    this.container.addChild(this.shootAnim.sprite);

    // Particle system for spire effects
    const spireTexture = textures.getFrames('lib_spire')[0];
    this.particles = new ASParticleSystem(spireTexture);
    this.container.addChildAt(this.particles.container, 0);

    // Move animation that spawns particles
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      ...calculateAnchor(MOVE_MANIFEST),
      scale: init.scale,
    }));
    this.moveAnim.sprite.position.set(0, init.casterY);
    this.moveAnim
      .onFrame(0, () => this.spawnSpires())
      .onFrame(1, () => this.spawnSpires())
      .onFrame(2, () => this.spawnSpires())
      .onFrame(3, () => this.spawnSpires())
      .onFrame(4, () => this.spawnSpires())
      .onFrame(5, () => this.spawnSpires())
      .onFrame(6, () => {
        this.spawnSpires();
        // Frame 7 in AS: gotoAndPlay(4), which is frame 3 in 0-indexed
        this.moveAnim.startFrame = 3;
      });
    this.container.addChild(this.moveAnim.sprite);

    // Signal hit early in the animation (around sound trigger)
    this.shootAnim.onFrame(3, () => this.signalHit());
  }

  private spawnSpires(): void {
    // Spawn 2 particles per frame as in AS
    for (let i = 0; i < 2; i++) {
      this.particleCounter++;
      
      // AS formulas exactly as written
      const va = 1.5 + Math.floor(Math.random() * 5);  // AS: va = 1.5 + random(5)
      const initialAlpha = 50 + Math.floor(Math.random() * 50);  // AS: _alpha = 50 + random(50)
      const yScale = 80 + Math.floor(Math.random() * 40);  // AS: _yscale = 80 + random(40)
      const v = 1 + 2.5 * Math.random();  // AS: v = 1 + 2.5 * Math.random()

      // Spawn particle with exact physics from AS
      this.particles.spawn({
        x: this.moveAnim.sprite.x,
        y: this.moveAnim.sprite.y,
        vx: -v,  // Negative because AS does _X = _X - v
        vy: 0,
        accX: 0.9,  // AS: v *= 0.9 is equivalent to velocity decay
        accY: 1,
        vr: 0,
        vrDecay: 1,
        t: initialAlpha,  // Using t for alpha
        vt: -va,  // Negative alpha velocity for fade out
        vtDecay: 1,
        scaleX: 2,  // AS: _xscale = 200 means 2x scale
        scaleY: yScale / 100,  // Convert percentage to decimal
        vScaleX: -0.03,  // AS: _xscale * 0.97 means -3% per frame
        vScaleY: 0,
        frame: this.particleCounter % 2,  // AS: gotoAndStop(1 + c % 2)
        rotation: this.moveAnim.sprite.rotation,
      });
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    // Complete when shoot animation is done and no more particles
    if (this.shootAnim.isComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}