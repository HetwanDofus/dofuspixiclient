/**
 * Spell 2017 - (Unknown name)
 *
 * A projectile spell that travels from caster to target.
 * The "shoot" animation plays at the target position.
 * On frame 1 of shoot, 7 fumee2 particles are spawned at the target.
 * A "move" sprite travels the path and continuously spawns fumee particles.
 * On frame 73 (0-indexed: 72), the shoot animation ends → removeMovieClip.
 *
 * Components:
 * - shoot (sprite_1): at target position, plays 75 frames, spawns fumee2 on frame 0
 * - move (DefineSprite_4): travels along the path, spawns fumee particles each frame
 * - fumee2 particles (lib_fumee2): spawned at shoot position with gravity physics
 * - fumee particles (lib_fumee): spawned along the projectile path
 *
 * Original AS timing:
 * - Frame 1 (shoot): spawn 7 fumee2 particles
 * - Frame 73 (shoot, 0-indexed 72): removeMovieClip → spell ends
 * - DefineSprite_4 (move): each enterFrame spawns ~0.67 fumee particles
 * - fumee2 frame 55 (0-indexed 54): removeMovieClip (particle dies)
 * - fumee frame 46 (0-indexed 45): removeMovieClip (particle dies)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

// fumee2 library symbol manifest
const FUMEE2_MANIFEST: SpriteManifest = {
  width: 8.7,
  height: 8.7,
  offsetX: -4.25,
  offsetY: -4.6,
};

// fumee library symbol manifest
const FUMEE_MANIFEST: SpriteManifest = {
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.05,
};

// shoot animation manifest (no offset data in manifest, use center)
const _SHOOT_MANIFEST: SpriteManifest = {
  width: 1,
  height: 1,
  offsetX: -0.5,
  offsetY: -0.5,
};

/**
 * fumee2 particle state - implements DefineSprite_8_fumee2 physics
 */
interface Fumee2Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vr: number;
  rotation: number;
  t: number; // scale percentage
  yi: number; // ground Y (bounce target)
  fin: number;
  a: number;
  alpha: number;
  alive: boolean;
  frameAnim: FrameAnimatedSprite;
  landed: boolean;
}

/**
 * fumee particle state - implements DefineSprite_13_fumee physics
 */
interface FumeeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number; // scale percentage
  alpha: number;
  alive: boolean;
  frameAnim: FrameAnimatedSprite;
}

export class Spell2017 extends BaseSpell {
  readonly spellId = 2017;

  private shootAnim!: FrameAnimatedSprite;
  private fumee2Particles: Fumee2Particle[] = [];
  private fumeeParticles: FumeeParticle[] = [];
  private fumee2Container!: Container;
  private fumeeContainer!: Container;

  // For the move sprite - tracking position for velocity calculation
  private moveX = 0;
  private moveY = 0;
  private prevMoveX = 0;
  private prevMoveY = 0;
  private moveFrameAccum = 0;
  private moveComplete = false;
  private readonly FRAME_TIME = 1000 / 60;
  private fumee2TexturesCache: ReturnType<SpellTextureProvider["getFrames"]> =
    [];
  private fumeeTexturesCache: ReturnType<SpellTextureProvider["getFrames"]> =
    [];
  private initContext!: SpellInitContext;

  // Shoot animation end frame
  private shootEnded = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.initContext = init;

    // Cache textures for particle spawning
    this.fumee2TexturesCache = textures.getFrames("lib_fumee2");
    this.fumeeTexturesCache = textures.getFrames("lib_fumee");

    // Containers
    this.fumeeContainer = new Container();
    this.fumee2Container = new Container();
    this.container.addChild(this.fumeeContainer);

    // Shoot animation at target position
    const shootTextures = textures.getFrames("shoot");
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: shootTextures,
        anchorX: 0.5,
        anchorY: 0.5,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // On frame 0 (AS frame 1): spawn 7 fumee2 particles
    this.shootAnim.onFrame(0, () => {
      this.spawnFumee2Particles(init.targetX, init.targetY);
    });

    // On frame 72 (AS frame 73): removeMovieClip → end
    this.shootAnim.onFrame(72, () => {
      this.shootEnded = true;
    });

    this.container.addChild(this.shootAnim.sprite);
    this.container.addChild(this.fumee2Container);

    // Initialize move position at caster (0, casterY) - projectile starts at caster
    this.moveX = 0;
    this.moveY = init.casterY;
    this.prevMoveX = 0;
    this.prevMoveY = init.casterY;

    // Signal hit immediately when shoot starts (projectile arrives at target)
    this.signalHit();
  }

  /**
   * Spawn 7 fumee2 particles at shoot position (AS: DefineSprite_1_shoot frame_1)
   * AS code: while(p < 7) { attachMovie("fumee2",...); f._x = this._x; f._y = this._y; f.vx = ...; f.vy = ... }
   */
  private spawnFumee2Particles(x: number, y: number): void {
    const init = this.initContext;
    let xi = x;
    // yi is not really used here since all are placed at same x,y
    // AS: f.vx = this._x - xi + 5 * (Math.random() - 0.5)
    // But xi = this._x each iteration after first, so vx = 0 + 5*(rand-0.5) after first
    // First iteration: xi = this._x (same), so vx = 0 + 5*(rand-0.5)
    // Actually xi starts as this._x so this._x - xi = 0 always
    // Each iteration: xi = this._x (always same), so vx = 5*(Math.random()-0.5)

    for (let p = 0; p < 7; p++) {
      const vx = x - xi + 5 * (Math.random() - 0.5);
      const vy = -6 * Math.random();

      // DefineSprite_8_fumee2 frame_1 initialization
      const t = 50 * Math.random() + 50;
      const scaleVal = (t / 100) * init.scale;

      // yi = _Y - 1.67 + 3.33 * Math.random() (ground bounce level)
      // In AS, _Y is the particle's initial Y (which is shoot._y)
      const yi = y - 1.67 + 3.33 * Math.random();

      // vr = 30 * Math.random() - 0.5
      const vr = 30 * Math.random() - 0.5;

      // Create the frame animation for this particle
      const frameAnim = new FrameAnimatedSprite({
        textures: this.fumee2TexturesCache,
        anchorX: -FUMEE2_MANIFEST.offsetX / FUMEE2_MANIFEST.width,
        anchorY: -FUMEE2_MANIFEST.offsetY / FUMEE2_MANIFEST.height,
        scale: scaleVal,
      });
      frameAnim.sprite.position.set(x, y);
      frameAnim.sprite.alpha = 1;
      // AS: stop() on frame 1, so it starts stopped (lands to play later)
      frameAnim.pause();

      this.fumee2Container.addChild(frameAnim.sprite);

      const particle: Fumee2Particle = {
        x,
        y,
        vx,
        vy,
        vr,
        rotation: 0,
        t,
        yi,
        fin: 0,
        a: 0,
        alpha: 1,
        alive: true,
        frameAnim,
        landed: false,
      };

      this.fumee2Particles.push(particle);
      xi = x;
    }
  }

  /**
   * Spawn fumee particles along the projectile path
   * AS: DefineSprite_4_move frame_1 onEnterFrame
   * nf = 0.67, spawns floor(nf) per frame = 0 most frames but accumulates
   */
  private spawnFumeeParticle(): void {
    const init = this.initContext;
    const x = this.moveX;
    const y = this.moveY;

    // AS: _loc2_.vx = this._x - xi + 6.67 * (Math.random() - 0.5)
    // AS: _loc2_.vy = this._y - yi + 6.67 * (Math.random() - 0.5)
    const vxBase = x - this.prevMoveX;
    const vyBase = y - this.prevMoveY;
    const vx = vxBase + 6.67 * (Math.random() - 0.5);
    const vy = vyBase + 6.67 * (Math.random() - 0.5);

    // DefineSprite_13_fumee frame_1 initialization
    const t = 50 * Math.random() + 50;
    const scaleVal = (t / 100) * init.scale;

    // AS: vx /= 3 + 3 * Math.random(); vy /= 3 + random(3);
    const vxFinal = vx / (3 + 3 * Math.random());
    const vyFinal = vy / (3 + Math.floor(Math.random() * 3));

    // AS: gotoAndPlay(random(30)) → 0-indexed: random start frame 0-29
    const startFrame = Math.floor(Math.random() * 30);

    const frameAnim = new FrameAnimatedSprite({
      textures: this.fumeeTexturesCache,
      anchorX: -FUMEE_MANIFEST.offsetX / FUMEE_MANIFEST.width,
      anchorY: -FUMEE_MANIFEST.offsetY / FUMEE_MANIFEST.height,
      scale: scaleVal,
      startFrame,
    });
    frameAnim.sprite.position.set(x, y);

    this.fumeeContainer.addChild(frameAnim.sprite);

    const particle: FumeeParticle = {
      x,
      y,
      vx: vxFinal,
      vy: vyFinal,
      t,
      alpha: 1,
      alive: true,
      frameAnim,
    };

    this.fumeeParticles.push(particle);
    this.fumeeCounter++;
  }

  /**
   * Update fumee2 particles (DefineSprite_8_fumee2 onEnterFrame physics)
   */
  private updateFumee2Particles(deltaTime: number): void {
    for (const p of this.fumee2Particles) {
      if (!p.alive) {
        continue;
      }

      // Update frame animation
      if (p.landed) {
        p.frameAnim.update(deltaTime);
        // AS frame 55 (0-indexed 54): removeMovieClip
        if (p.frameAnim.getFrame() >= 54 || p.frameAnim.isComplete()) {
          p.alive = false;
          p.frameAnim.sprite.visible = false;
          continue;
        }
      }

      // AS physics (per enterFrame, which is per game frame)
      // We run this at 60fps equivalent
      const framesElapsed = deltaTime / this.FRAME_TIME;

      for (let f = 0; f < framesElapsed; f++) {
        if (p.fin === 1) {
          // AS: _alpha = 150 - (a += 3.3)
          p.a += 3.3;
          p.alpha = (150 - p.a) / 100;
        }

        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.vr;

        if (p.y > p.yi) {
          // Bounce: vy = (-vy) / 9
          p.vy = -p.vy / 9;
          p.y = p.yi;
          p.rotation = 0;
          p.vr = 0;
          p.vx = 0;
          p.fin = 1;
          // AS: play() → resume animation
          if (!p.landed) {
            p.landed = true;
            p.frameAnim.play();
          }
        }

        p.vy += 0.5;
      }

      p.frameAnim.sprite.position.set(p.x, p.y);
      p.frameAnim.sprite.rotation = (p.rotation * Math.PI) / 180;
      p.frameAnim.sprite.alpha = Math.max(0, p.alpha);

      if (p.alpha <= 0) {
        p.alive = false;
        p.frameAnim.sprite.visible = false;
      }
    }
  }

  /**
   * Update fumee particles (DefineSprite_13_fumee onEnterFrame physics)
   */
  private updateFumeeParticles(deltaTime: number): void {
    for (const p of this.fumeeParticles) {
      if (!p.alive) {
        continue;
      }

      // Update frame animation
      p.frameAnim.update(deltaTime);

      // AS frame 46 (0-indexed 45): removeMovieClip
      if (p.frameAnim.getFrame() >= 45 || p.frameAnim.isComplete()) {
        p.alive = false;
        p.frameAnim.sprite.visible = false;
        continue;
      }

      // Physics (per frame)
      const framesElapsed = deltaTime / this.FRAME_TIME;

      for (let f = 0; f < framesElapsed; f++) {
        p.x += p.vx;
        p.y += p.vy;
        // AS: vx /= 1.2; vy /= 1.2
        p.vx /= 1.2;
        p.vy /= 1.2;
      }

      p.frameAnim.sprite.position.set(p.x, p.y);
    }
  }

  /**
   * Update the move sprite position (travels from caster to target)
   * The projectile moves linearly over the shoot animation's first ~72 frames
   */
  private updateMoveSprite(deltaTime: number): void {
    if (this.moveComplete) {
      return;
    }

    this.moveFrameAccum += deltaTime;
    const totalFrames = 72; // frames to travel (shoot ends at frame 72)
    const totalTime = totalFrames * this.FRAME_TIME;
    const progress = Math.min(this.moveFrameAccum / totalTime, 1.0);

    this.prevMoveX = this.moveX;
    this.prevMoveY = this.moveY;

    const init = this.initContext;
    this.moveX = init.targetX * progress;
    this.moveY = init.casterY + (init.targetY - init.casterY) * progress;

    // Spawn fumee particles along the path (nf = 0.67 per frame)
    // AS: while(_loc3_ < nf) { spawn; _loc3_++ } → spawns floor(nf) = 0 per frame
    // but nf=0.67 means it never spawns in one frame (0 < 0.67 but 1 is not < 0.67)
    // Actually AS: _loc3_ starts 0, loop while _loc3_ < 0.67, so spawns 1 particle then _loc3_=1 >= 0.67 → stops
    // So it spawns exactly 1 particle per enterFrame!
    // Wait: "while(_loc3_ < nf)" with _loc3_=0, nf=0.67 → 0 < 0.67 is true → spawn → _loc3_++ → _loc3_=1 → 1 < 0.67 is false → stop
    // So exactly 1 fumee particle per frame of the move sprite

    const framesElapsed = Math.floor(this.moveFrameAccum / this.FRAME_TIME);
    const previousFrames = Math.floor(
      (this.moveFrameAccum - deltaTime) / this.FRAME_TIME
    );
    const newFrames = framesElapsed - previousFrames;

    for (let i = 0; i < newFrames; i++) {
      this.spawnFumeeParticle();
    }

    if (progress >= 1.0) {
      this.moveComplete = true;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update the main shoot animation
    this.anims.update(deltaTime);

    // Update move sprite position and spawn fumee particles
    this.updateMoveSprite(deltaTime);

    // Update particles
    this.updateFumee2Particles(deltaTime);
    this.updateFumeeParticles(deltaTime);

    // Check completion: shoot animation ended AND no alive particles
    if (this.shootEnded || this.shootAnim.isComplete()) {
      const hasFumee2 = this.fumee2Particles.some((p) => p.alive);
      const hasFumee = this.fumeeParticles.some((p) => p.alive);

      if (!hasFumee2 && !hasFumee) {
        this.complete();
      }
    }
  }

  destroy(): void {
    // Destroy fumee2 particle frame animations
    for (const p of this.fumee2Particles) {
      p.frameAnim.destroy();
    }
    this.fumee2Particles = [];

    // Destroy fumee particle frame animations
    for (const p of this.fumeeParticles) {
      p.frameAnim.destroy();
    }
    this.fumeeParticles = [];

    super.destroy();
  }
}
