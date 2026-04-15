/**
 * Spell 2059
 *
 * A projectile ("shoot") spell that travels from caster to target,
 * trailing smoke particles (fumee2) behind it. At the target, a
 * second particle emitter (move/fumee) creates a swirling impact effect.
 *
 * Components:
 * - shoot (sprite_3): Main projectile animation at caster, 75 frames.
 *   Frame 1: Spawns 7 fumee2 smoke puffs behind the projectile.
 *   Frame 73: removeMovieClip (spell ends).
 * - fumee2 particles: Smoke puffs spawned by shoot on frame 1.
 *   Physics: float upward with slight horizontal drift, gravity.
 * - move (DefineSprite_6_move): A spinning emitter at the target position.
 *   Each frame spawns 2 fumee particles at its current position.
 * - fumee particles: Small smoke puffs spawned by move each frame.
 *   Physics: drift from spawn velocity, slow down.
 *
 * Original AS timing:
 * - Frame 1 (shoot): spawn 7 fumee2 particles
 * - Frame 73 (shoot): removeMovieClip -> spell complete
 * - DefineSprite_5/frame_28: stop() -> move emitter stops at frame 27 (0-indexed)
 * - DefineSprite_13_fumee/frame_46: removeMovieClip -> fumee dies after 46 frames
 * - DefineSprite_11_fumee2/frame_49: removeMovieClip -> fumee2 dies after 49 frames
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

// ---- Manifests ----

const SHOOT_MANIFEST: SpriteManifest = {
  width: 132.8,
  height: 88.75,
  offsetX: -77.4,
  offsetY: -75.2,
};

const FUMEE2_MANIFEST: SpriteManifest = {
  width: 13.25,
  height: 8.25,
  offsetX: -8.45,
  offsetY: -7.3,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 2,
  height: 2.05,
  offsetX: -0.3,
  offsetY: -0.55,
};

// ---- Fumee2 particle state (custom, not ASParticleSystem) ----
// fumee2 has: position, vx, vy (vy includes gravity 0.5/frame), scale, frame counter
interface Fumee2Particle {
  /** Sprite (FrameAnimatedSprite) */
  anim: FrameAnimatedSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** current frame counter for lifetime */
  frameCount: number;
  alive: boolean;
}

// ---- Fumee particle state ----
interface FumeeParticle {
  anim: FrameAnimatedSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** current frame counter for lifetime */
  frameCount: number;
  alive: boolean;
}

export class Spell2059 extends BaseSpell {
  readonly spellId = 2059;

  // Main shoot animation
  private shootAnim!: FrameAnimatedSprite;

  // Fumee2 (large smoke puffs from projectile)
  private fumee2Textures: Texture[] = [];
  private fumee2Particles: Fumee2Particle[] = [];

  // Fumee (small smoke puffs from move emitter)
  private fumeeTextures: Texture[] = [];
  private fumeeParticles: FumeeParticle[] = [];

  // Move emitter (spins at target, spawns fumee each frame)
  private moveAnim!: FrameAnimatedSprite;
  private moveX = 0;
  private moveY = 0;
  private prevMoveX = 0;
  private prevMoveY = 0;
  private moveRotation = 0; // degrees, increments by 150 each frame
  private moveFrameCount = 0;
  private readonly MOVE_STOP_FRAME = 27; // DefineSprite_5 frame_28 -> stop() at index 27

  // Fumee counter (used as depth/name counter in AS)
  private fumeeCounter = 0;
  private fumee2Counter = 0;

  // Time accumulator for frame stepping (shared 60fps clock)
  private frameAccum = 0;
  private readonly FRAME_TIME = 1000 / 60;

  // Scale
  private initScale = 1;

  // Containers
  private particleContainer!: Container;

  // Track whether shoot has completed
  private shootDone = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.initScale = init.scale;

    // Container for all particles (behind/above everything)
    this.particleContainer = new Container();
    this.container.addChild(this.particleContainer);

    // Pre-load textures for particles
    this.fumee2Textures = textures.getFrames('lib_fumee2');
    this.fumeeTextures = textures.getFrames('lib_fumee');

    // ---- Shoot animation (DefineSprite_3_shoot) ----
    // Positioned at caster, rotation = 0 (AS sets _rotation = 0)
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = 0;

    // Frame 1 (index 0): spawn 7 fumee2 particles
    this.shootAnim.onFrame(0, () => {
      this.spawnFumee2Burst(0, init.casterY);
    });

    // Frame 73 (index 72): removeMovieClip -> spell ends
    // We track completion via shootAnim completing naturally (75 frames),
    // but the AS removes at frame 73 so we stop at 72 (0-indexed)
    this.shootAnim.stopAt(72);
    this.container.addChild(this.shootAnim.sprite);

    // ---- Move emitter (DefineSprite_6_move) at target position ----
    // In AS, DefineSprite_5 contains the move emitter and stops at frame 28 (index 27)
    // The move emitter spins (_rotation += 150) and spawns 2 fumee particles per frame
    // We simulate this manually in update()
    this.moveX = init.targetX;
    this.moveY = init.targetY;
    this.prevMoveX = init.targetX;
    this.prevMoveY = init.targetY;
    this.moveRotation = 0;
    this.moveFrameCount = 0;

    // We also need a visual for the move emitter (DefineSprite_6_move has a child spinner)
    // The spinner (DefineSprite_7) just rotates, not directly visible as a key element.
    // We don't need to render DefineSprite_7's child since it's just the emitter position.
    // However, DefineSprite_10 inside move sets _rotation = random(360) - just a decorative element.
    // We'll skip rendering the move emitter itself (it's a tiny smoke emitter point).

    // ---- Hit signal ----
    // AS doesn't have an explicit end() call - the hit is signaled when the
    // shoot animation completes (frame 73). We'll signal hit at frame 72 (stop).
    this.shootAnim.onFrame(72, () => {
      this.signalHit();
    });
  }

  /**
   * Spawn 7 fumee2 smoke puffs from the shoot sprite's current position.
   * AS: while(p < 7) { attachMovie("fumee2", ...); f._x = this._x; f._y = this._y - 30; ... }
   */
  private spawnFumee2Burst(spawnX: number, spawnY: number): void {
    // AS: xi = this._x; yi = this._y; c = 0;
    // In the loop, xi/yi are updated to this._x/this._y each iteration
    // (but _x/_y doesn't change during spawn, so xi stays = spawnX)
    let xi = spawnX;

    for (let p = 0; p < 7; p++) {
      const textures = this.fumee2Textures;
      if (textures.length === 0) {
        break;
      }

      const anchor = calculateAnchor(FUMEE2_MANIFEST);

      // AS: t = 20 * Math.random() + 80; gotoAndPlay(random(45)); _xscale = t; _yscale = t;
      const t = 20 * Math.random() + 80;
      const startFrame = Math.floor(Math.random() * 45);

      const anim = new FrameAnimatedSprite({
        textures,
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: (t / 100) * this.initScale,
        startFrame,
      });

      // AS: f._x = this._x; f._y = this._y - 30;
      const fx = spawnX;
      const fy = spawnY - 30 * this.initScale;

      anim.sprite.position.set(fx, fy);
      this.particleContainer.addChild(anim.sprite);

      // AS: f.vx = this._x - xi + 5 * (Math.random() - 0.5);
      // AS: f.vy = -7 * Math.random();
      // On first iteration: this._x - xi = spawnX - spawnX = 0
      const vx = (spawnX - xi) + 5 * (Math.random() - 0.5);
      const vy = -7 * Math.random();

      // AS fumee2 onEnterFrame: _X += vx; _Y += vy; vy += 0.5;
      const particle: Fumee2Particle = {
        anim,
        x: fx,
        y: fy,
        vx,
        vy,
        frameCount: startFrame,
        alive: true,
      };

      this.fumee2Particles.push(particle);

      // AS: c++; xi = this._x; yi = this._y;
      this.fumee2Counter++;
      xi = spawnX;
    }
  }

  /**
   * Spawn fumee particles from move emitter.
   * AS: while(_loc3_ < nf) { attachMovie("fumee","fumee"+c,c+5); ... }
   * nf = 2 -> spawn 2 per frame
   */
  private spawnFumeeParticles(): void {
    const textures = this.fumeeTextures;
    if (textures.length === 0) {
      return;
    }

    const anchor = calculateAnchor(FUMEE_MANIFEST);

    for (let i = 0; i < 2; i++) {
      // AS fumee frame_1: t = 50 * Math.random() + 50; gotoAndPlay(random(30));
      const t = 50 * Math.random() + 50;
      const startFrame = Math.floor(Math.random() * 30);

      const anim = new FrameAnimatedSprite({
        textures,
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: (t / 100) * this.initScale,
        startFrame,
      });

      // AS: _loc2_._x = this._x; _loc2_._y = this._y;
      const fx = this.moveX;
      const fy = this.moveY;
      anim.sprite.position.set(fx, fy);
      this.particleContainer.addChild(anim.sprite);

      // AS: vx = this._x - xi + 10*(Math.random()-0.5)
      //     vy = this._y - yi + 10*(Math.random()-0.5)
      let rawVx = (this.moveX - this.prevMoveX) + 10 * (Math.random() - 0.5);
      let rawVy = (this.moveY - this.prevMoveY) + 10 * (Math.random() - 0.5);

      // AS fumee frame_1: vx /= 3 + 3*Math.random(); vy /= 3 + random(3);
      rawVx /= 3 + 3 * Math.random();
      rawVy /= 3 + Math.floor(Math.random() * 3);

      const particle: FumeeParticle = {
        anim,
        x: fx,
        y: fy,
        vx: rawVx,
        vy: rawVy,
        frameCount: startFrame,
        alive: true,
      };

      this.fumeeParticles.push(particle);
      this.fumeeCounter++;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.frameAccum += deltaTime;

    // Process frame steps
    while (this.frameAccum >= this.FRAME_TIME) {
      this.frameAccum -= this.FRAME_TIME;
      this.stepFrame();
    }

    // Check completion: shoot done and all particles dead
    if (this.shootDone && this.allParticlesDead()) {
      this.complete();
    }
  }

  private stepFrame(): void {
    // Update shoot animation
    if (!this.shootDone) {
      const running = this.shootAnim.update(this.FRAME_TIME);
      if (!running || this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
        this.shootDone = true;
      }
    }

    // Update move emitter (spawns fumee particles each frame until frame 27)
    if (this.moveFrameCount <= this.MOVE_STOP_FRAME) {
      // AS: _rotation += 150 (decorative, no effect on position)
      this.moveRotation += 150;

      // Spawn fumee particles
      this.spawnFumeeParticles();

      // Update previous position (move emitter doesn't actually move in AS,
      // it stays at target position)
      this.prevMoveX = this.moveX;
      this.prevMoveY = this.moveY;

      this.moveFrameCount++;
    }

    // Update fumee2 particles
    for (const p of this.fumee2Particles) {
      if (!p.alive) {
        continue;
      }

      // AS fumee2 onEnterFrame: _X += vx; _Y += vy; vy += 0.5;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.5;

      p.anim.sprite.position.set(p.x, p.y);

      // Advance animation
      p.anim.update(this.FRAME_TIME);
      p.frameCount++;

      // AS frame_49 (index 48): removeMovieClip -> dies after reaching frame 49 (0-indexed 48)
      // The animation has 51 frames; it completes naturally or we check frame count
      if (p.anim.isComplete() || p.frameCount >= 49) {
        p.alive = false;
        p.anim.sprite.visible = false;
      }
    }

    // Update fumee particles
    for (const p of this.fumeeParticles) {
      if (!p.alive) {
        continue;
      }

      // AS fumee onEnterFrame: _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2;
      p.x += p.vx;
      p.y += p.vy;
      p.vx /= 1.2;
      p.vy /= 1.2;

      p.anim.sprite.position.set(p.x, p.y);

      // Advance animation
      p.anim.update(this.FRAME_TIME);
      p.frameCount++;

      // AS frame_46 (index 45): removeMovieClip -> dies after reaching frame 46 (0-indexed 45)
      if (p.anim.isComplete() || p.frameCount >= 46) {
        p.alive = false;
        p.anim.sprite.visible = false;
      }
    }
  }

  private allParticlesDead(): boolean {
    for (const p of this.fumee2Particles) {
      if (p.alive) {
        return false;
      }
    }
    for (const p of this.fumeeParticles) {
      if (p.alive) {
        return false;
      }
    }
    return true;
  }

  destroy(): void {
    // Destroy fumee2 particle anims
    for (const p of this.fumee2Particles) {
      p.anim.destroy();
    }
    this.fumee2Particles = [];

    // Destroy fumee particle anims
    for (const p of this.fumeeParticles) {
      p.anim.destroy();
    }
    this.fumeeParticles = [];

    super.destroy();
  }
}
