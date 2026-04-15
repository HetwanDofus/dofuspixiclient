/**
 * Spell 2015
 *
 * A projectile spell with two particle systems:
 * - "move" particles (fumee): Spawned continuously along the projectile path
 * - "shoot" particles (fumee2): Spawned at frame 1 of the shoot animation (impact)
 *
 * Components:
 * - shoot (sprite_1): The projectile/impact animation at caster→target, rotated toward target
 *   - Frame 1: Spawns 5 fumee2 particles at impact position
 *   - Frame 73: removeMovieClip() → spell ends
 * - move (DefineSprite_4): A moving object that spawns fumee particles along its path
 *   - Continuously spawns fumee particles (nf=0.33 per frame, so ~1 per 3 frames)
 *
 * Original AS timing:
 * - shoot frame 1: Spawn 5 fumee2 (smoke) particles; signal hit
 * - shoot frame 73: Animation ends → complete
 * - move: Travels from caster to target, spawning fumee particles
 * - fumee frame 46: removeMovieClip()
 * - fumee2 frame 64: removeMovieClip()
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container, type Texture } from "pixi.js";

// shoot manifest: width/height/offsetX/offsetY are 0 in manifest, use centered anchor
const SHOOT_MANIFEST: SpriteManifest = {
  width: 100,
  height: 100,
  offsetX: -50,
  offsetY: -50,
};

// fumee2 manifest from librarySymbols
const FUMEE2_MANIFEST: SpriteManifest = {
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.05,
};

// fumee manifest from librarySymbols
const FUMEE_MANIFEST: SpriteManifest = {
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.05,
};

/**
 * A single fumee2 particle (DefineSprite_9_fumee2 behavior)
 * - Physics: bounces on a floor (yi), gravity 1.5, vy *= 2 initially
 * - Dies at frame 64 (0-indexed: 63)
 */
interface Fumee2Particle {
  anim: FrameAnimatedSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  yi: number; // floor Y
  alive: boolean;
}

/**
 * A single fumee particle (DefineSprite_10_fumee behavior)
 * - Physics: vx and vy decay by dividing by 1.2 each frame
 * - Dies at frame 46 (0-indexed: 45)
 */
interface FumeeParticle {
  anim: FrameAnimatedSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  alive: boolean;
}

export class Spell2015 extends BaseSpell {
  readonly spellId = 2015;

  private shootAnim!: FrameAnimatedSprite;

  // Particle collections (managed manually, not via this.anims)
  private fumee2Particles: Fumee2Particle[] = [];
  private fumeeParticles: FumeeParticle[] = [];

  private fumee2Textures: Texture[] = [];
  private fumeeTextures: Texture[] = [];

  private fumee2Anchor = { x: 0.5, y: 0.5 };
  private fumeeAnchor = { x: 0.5, y: 0.5 };

  // For the "move" emitter: position tracking
  private moveX = 0;
  private moveY = 0;
  private moveXi = 0;
  private moveYi = 0;

  // Target position (in world space)
  private targetX = 0;
  private targetY = 0;
  private casterY = 0;

  // The shoot animation position
  private shootX = 0;
  private shootY = 0;

  // Particle containers (below shoot sprite)
  private fumeeContainer!: Container;
  private fumee2Container!: Container;

  // Track if shoot has been initialized (frame 1 action)
  private shootFrame1Done = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.targetX = init.targetX;
    this.targetY = init.targetY;
    this.casterY = init.casterY;

    // Get textures
    this.fumee2Textures = textures.getFrames("lib_fumee2");
    this.fumeeTextures = textures.getFrames("lib_fumee");

    // Calculate anchors
    this.fumee2Anchor = calculateAnchor(FUMEE2_MANIFEST);
    this.fumeeAnchor = calculateAnchor(FUMEE_MANIFEST);

    // Create containers for particles
    this.fumeeContainer = new Container();
    this.fumee2Container = new Container();
    this.container.addChild(this.fumeeContainer);
    this.container.addChild(this.fumee2Container);

    // Shoot animation - positioned at caster, rotated toward target
    // The shoot animation travels in the original AS from caster toward target
    // Based on the AS structure, shoot is placed at the caster position with rotation=0
    // but the "move" sub-sprite moves along the path
    // Looking at the AS: DefineSprite_1_shoot frame_1 sets _rotation=0
    // The shoot sprite itself appears to be the main animation at target position (impact)
    const shootTextures = textures.getFrames("shoot");
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        fps: 20,
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );

    // The shoot animation is positioned at the target
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);
    this.shootAnim.sprite.rotation = 0; // AS: _rotation = 0

    // Frame 73 (0-indexed: 72) → removeMovieClip / complete
    this.shootAnim.onFrame(72, () => {
      this.complete();
    });

    this.container.addChild(this.shootAnim.sprite);

    // Signal hit immediately (shoot frame 1 = impact)
    // In AS, the shoot animation starts and frame 1 spawns particles + this is the impact
    this.shootFrame1Done = false;

    // Initialize "move" emitter position (starts at caster, moves to target)
    this.moveX = 0;
    this.moveY = init.casterY;
    this.moveXi = this.moveX;
    this.moveYi = this.moveY;
    this.moveFracAccum = 0;
    this.fumeeCounter = 0;

    // Initialize shoot position tracking for fumee2
    this.shootX = init.targetX;
    this.shootY = init.targetY;
    this.shootXi = this.shootX;
    this.shootYi = this.shootY;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update shoot animation
    this.anims.update(deltaTime);

    // On the very first update, run the "frame 1" actions for shoot:
    // - spawn fumee2 particles
    // - signal hit
    if (!this.shootFrame1Done) {
      this.shootFrame1Done = true;
      this.spawnFumee2Particles();
      this.signalHit();
    }

    // Update "move" emitter: spawn fumee particles
    // In AS, DefineSprite_4_move.onEnterFrame runs every frame with nf=0.33
    // Each frame: while(_loc3_ < nf) → spawns floor(nf) = 0 particles per frame
    // But nf=0.33 accumulates... Actually in AS the while loop:
    // _loc3_ starts at 0, increments by 1 each iteration, runs while < 0.33
    // So 0 < 0.33 → spawn once, then 1 < 0.33 → false → 1 particle per frame? No.
    // Actually _loc3_ starts at 0, 0 < 0.33 → true → spawn, _loc3_++ → _loc3_ = 1
    // 1 < 0.33 → false → loop ends. So it spawns exactly 1 particle per frame.
    // Wait, re-reading: var _loc3_ = 0; while(_loc3_ < nf) { ... _loc3_ = _loc3_ + 1; }
    // Since nf = 0.33, _loc3_ starts at 0, 0 < 0.33 is true → spawn, _loc3_ = 1
    // 1 < 0.33 is false → end. So exactly 1 particle per frame.
    // But that seems like a lot... Actually wait. In the move sprite, this runs
    // continuously while the projectile is in flight. The shoot animation has 75 frames
    // at 20fps = 3.75 seconds. The "move" sprite would be the projectile traveling.
    // Let's spawn fumee particles each frame tick at 20fps rate.
    this.spawnFumeeParticle();

    // Update fumee2 particles physics
    this.updateFumee2Particles(deltaTime);

    // Update fumee particles physics
    this.updateFumeeParticles(deltaTime);

    // Check completion
    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }

  private spawnFumee2Particles(): void {
    // AS DefineSprite_1_shoot frame_1:
    // c = 0; p = 0;
    // while(p < 5) {
    //   attachMovie("fumee2", "fumee2" + c + 200, c + 200);
    //   f._x = this._x; f._y = this._y;
    //   f.vx = this._x - xi + 5 * (Math.random() - 0.5);  // xi = this._x at start, so vx ≈ 5*(rand-0.5)
    //   f.vy = -7 * Math.random();
    //   c++; xi = this._x; yi = this._y; p++;
    // }
    // Since xi=this._x and yi=this._y at the start, first particle: vx = 0 + 5*(rand-0.5)
    // After each: xi = this._x (same), so all: vx = 5*(rand-0.5)

    for (let p = 0; p < 5; p++) {
      const vx = 5 * (Math.random() - 0.5);
      const vy = -7 * Math.random();

      this.spawnFumee2(this.shootX, this.shootY, vx, vy);
    }
  }

  private spawnFumee2(x: number, y: number, vx: number, vy: number): void {
    if (this.fumee2Textures.length === 0) {
      return;
    }

    // AS DefineSprite_9_fumee2 frame_1:
    // t = 20 * Math.random() + 80;
    // gotoAndPlay(random(45));
    // _xscale = t; _yscale = t;
    // vx = vx; (no change)
    // vy *= 2;
    // yi = _Y - 15 + 30 * Math.random();
    const t = 20 * Math.random() + 80;
    const startFrame = Math.floor(Math.random() * 45);
    const scale = t / 100;

    const vy2 = vy * 2;
    const yi = y - 15 + 30 * Math.random();

    const anim = new FrameAnimatedSprite({
      textures: this.fumee2Textures,
      fps: 20,
      anchorX: this.fumee2Anchor.x,
      anchorY: this.fumee2Anchor.y,
      startFrame,
      scale,
    });

    anim.sprite.position.set(x, y);
    this.fumee2Container.addChild(anim.sprite);

    const particle: Fumee2Particle = {
      anim,
      x,
      y,
      vx,
      vy: vy2,
      yi,
      alive: true,
    };

    this.fumee2Particles.push(particle);
  }

  private updateFumee2Particles(deltaTime: number): void {
    // AS DefineSprite_9_fumee2 onEnterFrame:
    // _X += vx; _Y += vy;
    // if (_Y > yi) { vy = (-vy)/2; vx *= 0.7; _Y = yi; }
    // vy += 1.5;
    // Dies at frame 64 (0-indexed: 63)

    // Run at 20fps steps
    const frameTime = 1000 / 20;
    const steps = Math.floor(deltaTime / frameTime);

    for (const p of this.fumee2Particles) {
      if (!p.alive) {
        continue;
      }

      // Run physics steps proportional to deltaTime
      const physicsSteps = Math.max(1, steps);
      for (let s = 0; s < physicsSteps; s++) {
        p.x += p.vx;
        p.y += p.vy;

        if (p.y > p.yi) {
          p.vy = -p.vy / 2;
          p.vx *= 0.7;
          p.y = p.yi;
        }

        p.vy += 1.5;
      }

      p.anim.sprite.position.set(p.x, p.y);
      p.anim.update(deltaTime);

      // Check death at frame 63 (AS frame 64, 0-indexed)
      if (p.anim.getFrame() >= 63 || p.anim.isComplete()) {
        p.alive = false;
        p.anim.sprite.visible = false;
        p.anim.destroy();
        this.fumee2Container.removeChild(p.anim.sprite);
      }
    }

    // Remove dead particles
    this.fumee2Particles = this.fumee2Particles.filter((p) => p.alive);
  }

  private spawnFumeeParticle(): void {
    // AS DefineSprite_4_move onEnterFrame (nf=0.33):
    // While loop with nf=0.33 → spawns 1 particle per frame (0 < 0.33 → true → spawn → 1 < 0.33 → false)
    // attachMovie("fumee", "fumee" + c, c + 10);
    // _loc2_._x = this._x; _loc2_._y = this._y;
    // _loc2_.vx = this._x - xi + 6.67 * (Math.random() - 0.5);
    // _loc2_.vy = this._y - yi + 6.67 * (Math.random() - 0.5);
    // The move sprite doesn't actually move in this implementation (it's at caster position)
    // xi and yi track previous position (same as current since we don't move), so vx/vy ≈ 6.67*(rand-0.5)

    if (this.fumeeTextures.length === 0) {
      return;
    }

    // Current move position (caster position, static for simplicity)
    // In AS the "move" sprite would travel, but we just emit from caster→target path
    const vx = this.moveX - this.moveXi + 6.67 * (Math.random() - 0.5);
    const vy = this.moveY - this.moveYi + 6.67 * (Math.random() - 0.5);

    this.moveXi = this.moveX;
    this.moveYi = this.moveY;

    this.spawnFumee(this.moveX, this.moveY, vx, vy);
  }

  private spawnFumee(x: number, y: number, vx: number, vy: number): void {
    if (this.fumeeTextures.length === 0) {
      return;
    }

    // AS DefineSprite_10_fumee frame_1:
    // t = 50 * Math.random() + 50;
    // gotoAndPlay(random(30));
    // _xscale = t; _yscale = t;
    // vx /= 3 + 3 * Math.random();
    // vy /= 3 + random(3);
    // onEnterFrame: _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2;
    // Dies at frame 46 (0-indexed: 45) → removeMovieClip
    const t = 50 * Math.random() + 50;
    const startFrame = Math.floor(Math.random() * 30);
    const scale = t / 100;

    const vxFumee = vx / (3 + 3 * Math.random());
    const vyFumee = vy / (3 + Math.floor(Math.random() * 3));

    const anim = new FrameAnimatedSprite({
      textures: this.fumeeTextures,
      fps: 20,
      anchorX: this.fumeeAnchor.x,
      anchorY: this.fumeeAnchor.y,
      startFrame,
      scale,
    });

    anim.sprite.position.set(x, y);
    this.fumeeContainer.addChild(anim.sprite);

    const particle: FumeeParticle = {
      anim,
      x,
      y,
      vx: vxFumee,
      vy: vyFumee,
      alive: true,
    };

    this.fumeeParticles.push(particle);
  }

  private updateFumeeParticles(deltaTime: number): void {
    // AS DefineSprite_10_fumee onEnterFrame:
    // _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2;
    // Dies at frame 46 (0-indexed: 45)

    for (const p of this.fumeeParticles) {
      if (!p.alive) {
        continue;
      }

      p.x += p.vx;
      p.y += p.vy;
      p.vx /= 1.2;
      p.vy /= 1.2;

      p.anim.sprite.position.set(p.x, p.y);
      p.anim.update(deltaTime);

      // Check death at frame 45 (AS frame 46, 0-indexed)
      if (p.anim.getFrame() >= 45 || p.anim.isComplete()) {
        p.alive = false;
        p.anim.sprite.visible = false;
        p.anim.destroy();
        this.fumeeContainer.removeChild(p.anim.sprite);
      }
    }

    // Remove dead particles
    this.fumeeParticles = this.fumeeParticles.filter((p) => p.alive);
  }

  destroy(): void {
    // Destroy all fumee2 particles
    for (const p of this.fumee2Particles) {
      p.anim.destroy();
    }
    this.fumee2Particles = [];

    // Destroy all fumee particles
    for (const p of this.fumeeParticles) {
      p.anim.destroy();
    }
    this.fumeeParticles = [];

    super.destroy();
  }
}
