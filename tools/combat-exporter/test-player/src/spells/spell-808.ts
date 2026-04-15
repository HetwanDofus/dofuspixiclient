/**
 * Spell 808 - Explosion/Rock spell
 *
 * A target-position explosion with flying rock particles.
 *
 * Components:
 * - Main animation (anim1): At target position, 180 frames, stops at frame 177
 * - Rock particles (pierres): 3 particles per spawn group, physics-based bouncing
 *
 * Original AS timing:
 * - DefineSprite_7 frame_1: gotoAndPlay(random(45) + 2) -> random start frame
 * - DefineSprite_7 frame_106: stop()
 * - DefineSprite_13 frame_1: SOMA.playSound("explosion")
 * - DefineSprite_13 frame_46: stop()
 * - DefineSprite_15 frame_1: attachMovie("pierres", ...) x3 particles
 * - DefineSprite_16 frame_178: _parent.removeMovieClip() -> animation ends
 * - Particles use bouncing physics with gravity (v += 1.5)
 *
 * Hit signal: at frame 0 (explosion starts immediately)
 * Complete: when main animation stops at frame 177
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 258.3,
  height: 480.45,
  offsetX: -133.35,
  offsetY: -432.8,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 4.75,
  height: 2.3,
  offsetX: -2.4,
  offsetY: -1.7,
};

/**
 * Extended particle with bouncing physics state
 * matching the AS onClipEvent(enterFrame) logic exactly
 */
interface PierreParticle {
  /** Parent container X position (AS: _parent._x) */
  parentX: number;
  /** Parent container Y position (AS: _parent._y) */
  parentY: number;
  /** Parent X velocity */
  vx: number;
  /** Parent Y velocity */
  vy: number;
  /** Inner Y position (AS: _Y) */
  innerY: number;
  /** Vertical velocity (AS: v) */
  v: number;
  /** Rotation (degrees) */
  rotation: number;
  /** Rotation velocity */
  vr: number;
  /** Scale percentage (AS: t) */
  t: number;
  /** Alpha (0-100) */
  alpha: number;
  /** Settled flag (AS: t == 1 means settled) */
  settled: boolean;
  /** Whether particle is alive */
  alive: boolean;
}

export class Spell808 extends BaseSpell {
  readonly spellId = 808;

  private mainAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;
  private pierreParticles: PierreParticle[] = [];

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Main animation at target position
    // DefineSprite_13 plays the main explosion with sound at frame 1
    // DefineSprite_16 wraps it and calls removeMovieClip at frame 178 (0-indexed: 177)
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // AS DefineSprite_13 frame_1: SOMA.playSound("explosion")
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound('explosion');
      this.signalHit();
    });

    // AS DefineSprite_16 frame_178 (0-indexed: 177): removeMovieClip -> complete
    this.mainAnim.stopAt(177);

    this.container.addChild(this.mainAnim.sprite);

    // Particle system for "pierres" (rocks)
    // AS DefineSprite_15 frame_1 onClipEvent(load): attachMovie("pierres",...) x3
    const pierresTexture = textures.getFrames('lib_pierres')[0];
    this.particles = new ASParticleSystem(pierresTexture);
    this.particles.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particles.container);

    // Spawn 3 pierre particles (AS: c = 0; while(c < 3) { attachMovie ... c++ })
    this.spawnPierres();
  }

  private spawnPierres(): void {
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);

    for (let c = 0; c < 3; c++) {
      // AS onClipEvent(load) physics initialization
      const vx = 5 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);
      const parentX = 20 * (Math.random() - 0.5);
      const parentY = 10 * (Math.random() - 0.5);
      const t = 60 + 40 * Math.random();
      const alpha = 20 + Math.floor(Math.random() * 90);
      const v = -12 * Math.random() - 3;
      const vr = 40 * (-0.5 + Math.random());

      const pierre: PierreParticle = {
        parentX,
        parentY,
        vx,
        vy,
        innerY: 0,
        v,
        rotation: 0,
        vr,
        t,
        alpha,
        settled: false,
        alive: true,
      };

      this.pierreParticles.push(pierre);

      // Spawn the visual particle
      const particle = this.particles.spawn({
        x: parentX,
        y: parentY,
        t,
        alpha: alpha / 100,
        rotation: 0,
      });

      // Apply anchor from manifest
      particle.sprite.anchor.set(pierresAnchor.x, pierresAnchor.y);
    }
  }

  private updatePierres(): void {
    for (let i = 0; i < this.pierreParticles.length; i++) {
      const pierre = this.pierreParticles[i];

      if (!pierre.alive) {
        continue;
      }

      const particle = this.particles['particles'][i];

      if (!particle) {
        continue;
      }

      // AS: _parent._x += vx; _parent._y += vy;
      pierre.parentX += pierre.vx;
      pierre.parentY += pierre.vy;

      if (!pierre.settled) {
        // AS: _Y = _Y + v
        pierre.innerY += pierre.v;
        // AS: _rotation = _rotation + vr
        pierre.rotation += pierre.vr;
        // AS: v += 1.5
        pierre.v += 1.5;

        if (pierre.innerY > 0) {
          // Bounce: AS: vx /= 2; vy /= 2; _rotation = 0; _Y = 0; v = (-v) / 4
          pierre.vx /= 2;
          pierre.vy /= 2;
          pierre.rotation = 0;
          pierre.innerY = 0;
          pierre.v = (-pierre.v) / 4;

          if (Math.abs(pierre.v) < 1) {
            pierre.vx = 0;
            pierre.vy = 0;
            pierre.settled = true;
          }
        }
      }

      // Update the visual particle position
      // Total Y = parentY + innerY
      particle.x = pierre.parentX;
      particle.y = pierre.parentY + pierre.innerY;
      particle.rotation = pierre.rotation;

      particle.sprite.position.set(particle.x, particle.y);
      particle.sprite.rotation = (particle.rotation * Math.PI) / 180;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updatePierres();

    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
