/**
 * Spell 513 - Pierres (Rocks)
 *
 * A rock-throw spell with particle stones that bounce after impact.
 *
 * Components:
 * - shoot (sprite): Full 264-frame composite animation at target position
 *   Contains embedded "pierres" particle group (DefineSprite_60) which
 *   spawns 5 "pierres" particles with bounce physics
 *
 * Original AS timing (1-indexed → 0-indexed):
 * - Frame 4  (idx 3):  Play sound 'many_501', set position to cellTo
 * - Frame 109 (idx 108): Play sound 'many_502'
 * - Frame 124 (idx 123): Play sound 'explosion'
 * - Frame 127 (idx 126): this.end() → signalHit
 * - Frame 151 (idx 150): Play sound 'pic'
 * - Frame 166 (idx 165): Play sound 'pic'
 * - Frame 181 (idx 180): Play sound 'pic'
 * - Frame 193 (idx 192): Play sound 'pic'
 * - Frame 262 (idx 261): removeMovieClip / stop → complete
 *
 * Particle system (DefineSprite_3_pierres):
 * - 5 "pierres" particles spawned on load
 * - Physics: gravity bounce, rotation, fade out when settled
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 177.65,
  height: 220.1,
  offsetX: -89.65,
  offsetY: -175.25,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 6.4,
  height: 4.55,
  offsetX: -3.2,
  offsetY: -2.2,
};

/**
 * Internal state for a single "pierres" particle with bounce physics.
 * Replicates DefineSprite_3_pierres onClipEvent(load) and onClipEvent(enterFrame).
 */
interface PierreParticle {
  // Parent container position (the _parent._x / _parent._y in AS)
  parentX: number;
  parentY: number;
  // Per-frame velocity of the parent container
  vx: number;
  vy: number;
  // The inner sprite's local Y (_Y in AS)
  localY: number;
  // Vertical velocity of the inner sprite
  v: number;
  // Rotation velocity
  vr: number;
  // Current rotation
  rotation: number;
  // Whether settled (t === 1 in AS)
  settled: boolean;
  // Scale
  scale: number;
  // Alpha
  alpha: number;
}

export class Spell513 extends BaseSpell {
  readonly spellId = 513;

  private shootAnim!: FrameAnimatedSprite;
  private particlesContainer!: Container;
  private pierreParticles: PierreParticle[] = [];
  private pierreSystem!: ASParticleSystem;
  private particlesSpawned = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // The shoot animation is positioned at the target cell
    const shootTextures = textures.getFrames('shoot');
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: shootTextures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // AS frame_4/DoAction_2.as: _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // Position is at target cell
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Sound and event callbacks (all 0-indexed)
    this.shootAnim
      .onFrame(3, () => this.callbacks.playSound('many_501'))
      .onFrame(108, () => this.callbacks.playSound('many_502'))
      .onFrame(123, () => this.callbacks.playSound('explosion'))
      .onFrame(126, () => this.signalHit())
      .onFrame(150, () => this.callbacks.playSound('pic'))
      .onFrame(165, () => this.callbacks.playSound('pic'))
      .onFrame(180, () => this.callbacks.playSound('pic'))
      .onFrame(192, () => this.callbacks.playSound('pic'))
      .stopAt(261);

    this.container.addChild(this.shootAnim.sprite);

    // Set up particle system for "pierres" (stones)
    // DefineSprite_60 spawns 5 pierres on load
    const pierresTexture = textures.getFrames('lib_pierres')[0];
    this.pierreSystem = new ASParticleSystem(pierresTexture);

    // Container for particles, positioned at target
    this.particlesContainer = new Container();
    this.particlesContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particlesContainer);
    this.particlesContainer.addChild(this.pierreSystem.container);

    // Spawn 5 pierres particles (c = 0; while(c < 5))
    this.spawnPierres(init.scale);
    this.particlesSpawned = true;
  }

  private spawnPierres(scale: number): void {
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);
    const count = 5;

    for (let c = 0; c < count; c++) {
      // onClipEvent(load) for pierres:
      const vx = 5 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);
      const parentX = 20 * (Math.random() - 0.5);
      const parentY = 10 * (Math.random() - 0.5);
      const t = 60 + 40 * Math.random();
      const alpha = (20 + Math.floor(Math.random() * 90)) / 100;
      const v = -15 * Math.random() - 5;
      const vr = 140 * (-0.5 + Math.random());

      const particle: PierreParticle = {
        parentX,
        parentY,
        vx,
        vy,
        localY: 0,
        v,
        vr,
        rotation: 0,
        settled: false,
        scale: (t / 100) * scale,
        alpha,
      };

      this.pierreParticles.push(particle);

      // Spawn into the AS particle system using its spawn method
      // We'll manage the physics manually via pierreParticles array
      // and use the ASParticleSystem just for sprite management
      const sprite = this.pierreSystem.spawn({
        x: parentX,
        y: parentY,
        t: t,
        alpha: alpha * 100, // ASParticleSystem alpha is 0-1 but spawn expects config
      });
      // Override the sprite alpha since ASParticleSystem.spawn sets it directly
      sprite.sprite.alpha = alpha;
      sprite.sprite.anchor.set(pierresAnchor.x, pierresAnchor.y);
      sprite.sprite.scale.set((t / 100) * scale);
    }
  }

  private updatePierres(): void {
    const particles = this.pierreSystem['particles'] as Array<{
      sprite: { position: { set: (x: number, y: number) => void }; rotation: number; alpha: number };
      alive: boolean;
      x: number;
      y: number;
    }>;

    for (let i = 0; i < this.pierreParticles.length; i++) {
      const p = this.pierreParticles[i];
      const spriteData = particles[i];

      if (!spriteData || !spriteData.alive) {
        continue;
      }

      // onClipEvent(enterFrame):
      // _parent._x += vx;
      // _parent._y += vy;
      p.parentX += p.vx;
      p.parentY += p.vy;

      if (!p.settled) {
        // _Y += v
        p.localY += p.v;
        // _rotation += vr
        p.rotation += p.vr;
        // v += 1
        p.v += 1;

        if (p.localY > 0) {
          // Bounce
          p.vx /= 2;
          p.vy /= 2;
          p.rotation = 0;
          p.localY = 0;
          p.v = (-p.v) / 4;

          if (Math.abs(p.v) < 1) {
            p.vx = 0;
            p.vy = 0;
            p.settled = true;
          }
        }
      }

      // Apply to sprite: parent position + local Y offset
      spriteData.sprite.position.set(p.parentX, p.parentY + p.localY);
      spriteData.sprite.rotation = (p.rotation * Math.PI) / 180;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.particlesSpawned) {
      this.updatePierres();
    }

    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    this.pierreSystem.destroy();
    super.destroy();
  }
}
