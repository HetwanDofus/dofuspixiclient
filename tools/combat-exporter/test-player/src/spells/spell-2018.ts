/**
 * Spell 2018
 *
 * A projectile spell with smoke particle effects. The "shoot" animation
 * travels from caster to target, spawning "fumee2" smoke particles along the way.
 * Each smoke particle uses AS-style physics: gravity, rotation, alpha fade.
 *
 * Components:
 * - shoot (sprite_1): Main projectile animation at caster position, plays 108 frames
 * - fumee2 (lib_fumee2): Smoke particles spawned at frame 1 of shoot animation
 *
 * Original AS timing:
 * - Frame 1 (shoot): Spawn 7 fumee2 smoke particles with physics
 * - Frame 106 (shoot): removeMovieClip / stop - animation ends
 * - Frame 1 (fumee2): Initialize physics (t, vx, vy, vr), onEnterFrame handler
 * - Frame 55 (fumee2): removeMovieClip
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const MOVE_MANIFEST: SpriteManifest = {
  width: 15.5,
  height: 5.3,
  offsetX: -9.7,
  offsetY: -2.7,
};

const FUMEE2_MANIFEST: SpriteManifest = {
  width: 3.6,
  height: 3.6,
  offsetX: -1.6,
  offsetY: -2.05,
};

/**
 * Fumee2 smoke particle with full AS physics simulation.
 *
 * AS onEnterFrame logic:
 * - If fin==1: fade alpha, scale up/down with vt
 * - _X += vx; _Y += vy; _rotation += vr
 * - If _Y > yi: land (stop vertical motion, play animation, fin=1)
 * - vy += 0.5 (gravity)
 */
interface Fumee2Particle {
  anim: FrameAnimatedSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  vr: number;
  t: number;
  vt: number;
  yi: number;
  fin: number;
  a: number;
  alive: boolean;
}

export class Spell2018 extends BaseSpell {
  readonly spellId = 2018;

  private shootAnim!: FrameAnimatedSprite;
  private fumee2Container!: Container;
  private fumee2Particles: Fumee2Particle[] = [];
  private fumee2Textures: Texture[] = [];
  private fumee2AnchorX = 0;
  private fumee2AnchorY = 0;
  private initScale = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.initScale = init.scale;

    // Precompute anchor for fumee2
    const fumee2Anchor = calculateAnchor(FUMEE2_MANIFEST);
    this.fumee2AnchorX = fumee2Anchor.x;
    this.fumee2AnchorY = fumee2Anchor.y;
    this.fumee2Textures = textures.getFrames('lib_fumee2');

    // Container for smoke particles (world space, not rotated)
    this.fumee2Container = new Container();
    this.fumee2Container.scale.set(init.scale);
    this.container.addChild(this.fumee2Container);

    // Shoot animation (the main projectile)
    const shootTextures = textures.getFrames('shoot');
    const moveAnchor = calculateAnchor(MOVE_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: shootTextures,
      fps: 40,
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      scale: init.scale,
    }));

    // Position at caster
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame 1 (0-indexed: 0): spawn smoke particles
    // Frame 106 (0-indexed: 105): animation ends
    this.shootAnim
      .onFrame(0, () => this.spawnFumee2Particles(init))
      .onFrame(55, () => this.signalHit())
      .stopAt(105);

    this.container.addChild(this.shootAnim.sprite);
  }

  private spawnFumee2Particles(init: SpellInitContext): void {
    // AS: _rotation = 0; xi = this._x; yi = this._y; c = 0;
    // The shoot sprite is at (0, casterY) in container space.
    // Particles are attached to _parent (world space), so use the shoot's position.
    const spawnX = 0;
    const spawnY = init.casterY / init.scale; // unscaled (fumee2Container is scaled)

    let xi = spawnX;
    // yi is used for landing threshold per particle
    let p = 0;
    while (p < 7) {
      // AS: f._x = this._x; f._y = this._y;
      const fx = spawnX;
      const fy = spawnY;

      // AS: f.vx = this._x - xi + 5 * (Math.random() - 0.5)
      const vx = (spawnX - xi) + 5 * (Math.random() - 0.5);

      // AS: f.vy = -5 * Math.random()
      const vy_init = -5 * Math.random();

      // fumee2 frame_1 DoAction:
      // t = 50 * Math.random() + 50
      const t = 50 * Math.random() + 50;
      // vt = 2
      const vt = 2;
      // vy *= 2 (applied to the vy that was set by parent)
      const vy = vy_init * 2;
      // yi = _Y - 5 + 10 * Math.random()
      const yi = fy - 5 + 10 * Math.random();
      // vr = 30 * Math.random() - 0.5
      const vr = 30 * Math.random() - 0.5;

      // Create a FrameAnimatedSprite for fumee2, starting stopped (frame 1 has stop())
      const anim = new FrameAnimatedSprite({
        textures: this.fumee2Textures,
        fps: 40,
        anchorX: this.fumee2AnchorX,
        anchorY: this.fumee2AnchorY,
        // starts stopped at frame 0, will be manually driven until fin==1 then play()
      });

      // Frame 55 (0-indexed: 54): removeMovieClip - mark dead
      const particle: Fumee2Particle = {
        anim,
        x: fx,
        y: fy,
        vx,
        vy,
        vr,
        t,
        vt,
        yi,
        fin: 0,
        a: 0,
        alive: true,
      };

      anim.onFrame(54, () => {
        particle.alive = false;
        anim.sprite.visible = false;
      });

      // Apply initial scale (t is percentage: t/100 * scale)
      anim.sprite.position.set(fx, fy);
      anim.sprite.scale.set((t / 100), (t / 100));
      anim.sprite.alpha = 1;

      // Pause at frame 0 (AS: stop() in frame_1)
      anim.pause();

      this.fumee2Container.addChild(anim.sprite);
      this.fumee2Particles.push(particle);

      xi = spawnX;
      p++;
    }
  }

  private updateFumee2Particles(deltaTime: number): void {
    for (const p of this.fumee2Particles) {
      if (!p.alive) {
        continue;
      }

      // AS onEnterFrame:
      if (p.fin === 1) {
        // _alpha = 150 - (a += 3.3)
        p.a += 3.3;
        const alpha = (150 - p.a) / 100;
        p.anim.sprite.alpha = Math.max(0, alpha);

        // _xscale = t * vt * 2; _yscale = t * vt
        const sxPct = p.t * p.vt * 2;
        const syPct = p.t * p.vt;
        p.anim.sprite.scale.set(sxPct / 100, syPct / 100);

        // vt -= (vt - 3) / 1.5
        p.vt -= (p.vt - 3) / 1.5;

        // Update animation (playing)
        p.anim.update(deltaTime);
      }

      // _X += vx; _Y += vy
      p.x += p.vx;
      p.y += p.vy;

      // _rotation += vr (in degrees, convert for pixi)
      p.anim.sprite.rotation += (p.vr * Math.PI) / 180;

      // if (_Y > yi) -> land
      if (p.y > p.yi) {
        p.vy = 0;
        p.y = p.yi;
        p.anim.sprite.rotation = 0;
        p.vr = 0;
        p.vx = 0;
        p.fin = 1;
        // play() -> resume animation
        p.anim.play();
      }

      // vy += 0.5 (gravity)
      p.vy += 0.5;

      // Apply position
      p.anim.sprite.position.set(p.x, p.y);

      // If alpha fully gone, mark dead
      if (p.fin === 1 && p.a >= 150) {
        p.alive = false;
        p.anim.sprite.visible = false;
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updateFumee2Particles(deltaTime);

    const allParticlesDone = this.fumee2Particles.every(p => !p.alive);

    if (this.shootAnim.isStopped() && allParticlesDone) {
      this.complete();
    }
  }

  destroy(): void {
    for (const p of this.fumee2Particles) {
      p.anim.destroy();
    }
    this.fumee2Particles = [];
    this.fumee2Container.destroy({ children: true });
    super.destroy();
  }
}
