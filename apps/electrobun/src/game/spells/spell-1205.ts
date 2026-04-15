/**
 * Spell 1205 - Panda Spell
 *
 * A projectile spell with trailing particle effects.
 *
 * Components:
 * - shoot (DefineSprite_8_shoot): Main animation at caster, rotated toward target
 *   - Frame 4: Reset rotation to 0
 *   - Frame 39: Attached movie starts fading alpha by 3.34 per frame
 *   - Frame 72: stop() and removeMovieClip()
 * - DefineSprite_6 particles: Bubble-like particles with angular velocity
 * - DefineSprite_4 particles: Scale-based particles with angular velocity
 * - DefineSprite_9_move: Flickering alpha effect (50 + random(50) per frame)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'm_panda_spell_a'
 * - Frame 4 (shoot): _rotation = 0
 * - Frame 39 (shoot): Attached movie fades alpha -= 3.34 per frame
 * - Frame 72 (shoot): stop() + removeMovieClip()
 *
 * Notes:
 * - The shoot animation has 74 frames (0-73), stops at frame 71 (AS frame 72)
 * - Hit is signaled when the shoot animation completes
 * - The manifest shows only "shoot" animation; particles are embedded AS sprites
 *   that we replicate with physics simulation
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  ASParticleSystem,
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 115.25,
  height: 64.5,
  offsetX: -66,
  offsetY: -32.3,
};

export class Spell1205 extends BaseSpell {
  readonly spellId = 1205;

  private shootAnim!: FrameAnimatedSprite;

  // Sprite6 particles: bubble-like with _xscale only (width-based)
  private sprite6Particles!: ASParticleSystem;

  // Sprite4 particles: scale-based (xscale = yscale = t)
  private sprite4Particles!: ASParticleSystem;

  // Per-particle state for sprite6 (angle, v, va, t)
  private sprite6States: Array<{
    angle: number;
    v: number;
    va: number;
    t: number;
  }> = [];

  // Per-particle state for sprite4 (angle, v, va, t)
  private sprite4States: Array<{
    angle: number;
    v: number;
    va: number;
    t: number;
  }> = [];

  private shootAlpha = 1;
  private shootFading = false;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const shootTextures = textures.getFrames("shoot");
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    // Main shoot animation at caster position, rotated toward target
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame 1 (0-indexed: 0): Play sound
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound("m_panda_spell_a");
    });

    // Frame 4 (0-indexed: 3): Reset rotation to 0
    this.shootAnim.onFrame(3, () => {
      this.shootAnim.sprite.rotation = 0;
    });

    // Frame 39 (0-indexed: 38): Start fading alpha
    this.shootAnim.onFrame(38, () => {
      this.shootFading = true;
    });

    // Frame 72 (0-indexed: 71): stop
    this.shootAnim.stopAt(71);

    this.container.addChild(this.shootAnim.sprite);

    // Sprite6 particles - bubble particles spawned near caster
    // Using a fallback texture if lib symbols aren't available
    const hasSprite6 = textures.hasTexture("lib_sprite6_0");
    if (hasSprite6) {
      const sprite6Texture = textures.getFrames("lib_sprite6")[0];
      this.sprite6Particles = new ASParticleSystem(sprite6Texture);
    } else {
      // Fallback: use first shoot frame as particle texture
      this.sprite6Particles = new ASParticleSystem(shootTextures[0]);
    }
    this.sprite6Particles.container.position.set(0, init.casterY);
    this.container.addChild(this.sprite6Particles.container);

    // Sprite4 particles - scale particles spawned near caster
    const hasSprite4 = textures.hasTexture("lib_sprite4_0");
    if (hasSprite4) {
      const sprite4Texture = textures.getFrames("lib_sprite4")[0];
      this.sprite4Particles = new ASParticleSystem(sprite4Texture);
    } else {
      this.sprite4Particles = new ASParticleSystem(shootTextures[0]);
    }
    this.sprite4Particles.container.position.set(0, init.casterY);
    this.container.addChild(this.sprite4Particles.container);

    // Spawn sprite6 particles
    // AS: angle = _parent._parent.angle; v = 0.67 + random(5); va = 20 * (-0.5 + Math.random()); t = 100
    const numSprite6 = 5;
    this.sprite6Particles.spawnMany(numSprite6, () => {
      const _angle = context?.angle ?? 0;
      const _v = 0.67 + Math.floor(Math.random() * 5);
      const _va = 20 * (-0.5 + Math.random());
      const t = 100;
      return {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        t,
        vt: 0,
        vtDecay: 0,
      };
      // Store state separately since ASParticleSystem handles position internally
      // We'll manage these manually below
    });

    // Reset and manage sprite6 manually with per-particle state
    this.sprite6Particles.clear();
    for (let i = 0; i < numSprite6; i++) {
      const angle = context?.angle ?? 0;
      const v = 0.67 + Math.floor(Math.random() * 5);
      const va = 20 * (-0.5 + Math.random());
      const t = 100;
      this.sprite6States.push({ angle, v, va, t });
      this.sprite6Particles.spawn({
        x: 0,
        y: 0,
        t: v * 10, // initial xscale = v * 10
        vt: 0,
        vtDecay: 0,
      });
    }

    // Spawn sprite4 particles
    // AS: angle = _parent._parent.angle; v = 0.67 + random(5); va = 20 * (-0.5 + Math.random()); t = 70 + random(30)
    const numSprite4 = 5;
    this.sprite4Particles.clear();
    for (let i = 0; i < numSprite4; i++) {
      const angle = context?.angle ?? 0;
      const v = 0.67 + Math.floor(Math.random() * 5);
      const va = 20 * (-0.5 + Math.random());
      const t = 70 + Math.floor(Math.random() * 30);
      this.sprite4States.push({ angle, v, va, t });
      this.sprite4Particles.spawn({
        x: 0,
        y: 0,
        t, // xscale = yscale = t
        vt: 0,
        vtDecay: 0,
      });
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Handle shoot alpha fading (frame 39+: _alpha -= 3.34 per frame)
    // We approximate: per update at 60fps, subtract 3.34 per frame
    if (this.shootFading) {
      // deltaTime is in ms, frame = deltaTime / (1000/60)
      const frames = deltaTime / (1000 / 60);
      this.shootAlpha -= (3.34 * frames) / 100; // 3.34 is percentage points, convert to 0-1
      this.shootAnim.sprite.alpha = Math.max(0, this.shootAlpha);
    }

    // Update sprite6 particles manually (AS onEnterFrame logic)
    const sprite6ParticlesArr = (
      this.sprite6Particles as unknown as {
        particles: Array<{
          alive: boolean;
          x: number;
          y: number;
          t: number;
          sprite: {
            position: { set: (x: number, y: number) => void };
            scale: { set: (s: number) => void };
            rotation: number;
          };
        }>;
      }
    ).particles;
    for (let i = 0; i < this.sprite6States.length; i++) {
      const state = this.sprite6States[i];
      const p = sprite6ParticlesArr?.[i];
      if (!p || !p.alive) {
        continue;
      }

      // AS: if(random(5) == 0) { va = 20 * (-0.5 + Math.random()); }
      if (Math.floor(Math.random() * 5) === 0) {
        state.va = 20 * (-0.5 + Math.random());
      }

      // AS: _xscale = v * 10; (only x scale)
      const xscale = state.v * 10;

      // AS: t *= 0.999
      state.t *= 0.999;

      // AS: angle += va
      state.angle += state.va;

      // AS: vx = Math.abs(v * Math.cos(angle * 0.017453292519943295))
      const vx = Math.abs(
        state.v * Math.cos(state.angle * 0.017453292519943295)
      );
      // AS: vy = v * Math.sin(angle * 0.017453292519943295)
      const vy = state.v * Math.sin(state.angle * 0.017453292519943295);

      // AS: _X = _X + vx; _Y = _Y + vy
      p.x += vx;
      p.y += vy;

      // AS: v *= 0.95
      state.v *= 0.95;

      // AS: _rotation = angle
      p.sprite.position.set(p.x, p.y);
      p.sprite.scale.set(xscale / 100);
      p.sprite.rotation = (state.angle * Math.PI) / 180;

      // Death condition: t < some threshold (AS doesn't explicitly kill, but v gets tiny)
      // t *= 0.999 will never reach 0 strictly, but _xscale = v*10 -> v*0.95^n -> ~0
      // We kill when scale becomes negligible
      if (xscale < 0.5) {
        p.alive = false;
        p.sprite.visible = false;
      }
    }

    // Update sprite4 particles manually (AS onEnterFrame logic)
    const sprite4ParticlesArr = (
      this.sprite4Particles as unknown as {
        particles: Array<{
          alive: boolean;
          x: number;
          y: number;
          t: number;
          sprite: {
            position: { set: (x: number, y: number) => void };
            scale: { set: (sx: number, sy: number) => void };
            rotation: number;
          };
        }>;
      }
    ).particles;
    for (let i = 0; i < this.sprite4States.length; i++) {
      const state = this.sprite4States[i];
      const p = sprite4ParticlesArr?.[i];
      if (!p || !p.alive) {
        continue;
      }

      // AS: if(random(3) == 1) { va = 20 * (-0.5 + Math.random()); }
      if (Math.floor(Math.random() * 3) === 1) {
        state.va = 20 * (-0.5 + Math.random());
      }

      // AS: _xscale = t; _yscale = t
      const scale = state.t;

      // AS: t *= 0.975
      state.t *= 0.975;

      // AS: angle += va
      state.angle += state.va;

      // AS: vx = Math.abs(v * Math.cos(angle * 0.017453292519943295))
      const vx = Math.abs(
        state.v * Math.cos(state.angle * 0.017453292519943295)
      );
      // AS: vy = v * Math.sin(angle * 0.017453292519943295)
      const vy = state.v * Math.sin(state.angle * 0.017453292519943295);

      // AS: _X = _X + vx; _Y = _Y + vy
      p.x += vx;
      p.y += vy;

      // AS: v *= 0.95
      state.v *= 0.95;

      p.sprite.position.set(p.x, p.y);
      p.sprite.scale.set(scale / 100, scale / 100);

      // Death: t < 0 (t *= 0.975 asymptotes to 0, kill when tiny)
      if (scale < 0.5) {
        p.alive = false;
        p.sprite.visible = false;
      }
    }

    // Signal hit when shoot animation completes/stops
    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      this.signalHit();
    }

    // Complete when shoot animation is done and no alive particles
    if (
      (this.shootAnim.isStopped() || this.shootAnim.isComplete()) &&
      !this.sprite6Particles.hasAliveParticles() &&
      !this.sprite4Particles.hasAliveParticles()
    ) {
      this.complete();
    }
  }

  destroy(): void {
    this.sprite6Particles.destroy();
    this.sprite4Particles.destroy();
    super.destroy();
  }
}
