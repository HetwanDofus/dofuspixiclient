/**
 * Spell 2012 - (Osamodas/Gobgob related)
 *
 * A projectile spell with smoke trail particles (fumee) spawned along the
 * path, and a burst of smoke puffs (fumee2) on impact.
 *
 * Components:
 * - shoot (sprite_3): Main projectile animation at target position, 75 frames
 * - move (sprite_6): Moving element that spawns fumee particles along trail
 * - fumee particles: Small smoke puffs spawned each frame along projectile path
 * - fumee2 particles: Larger smoke puffs spawned at frame 1 of shoot
 *
 * Original AS timing:
 * - Frame 1 (shoot): Spawn 7 fumee2 puffs at impact position
 * - Frame 73 (shoot): removeMovieClip() - animation ends
 * - Frame 46 (fumee): removeMovieClip()
 * - Frame 49 (fumee2): removeMovieClip()
 * - move/onEnterFrame: Spawn nf=5 fumee particles each frame
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

/**
 * Custom particle for fumee (small smoke along trail)
 * Physics from DefineSprite_13_fumee/frame_1/DoAction.as
 */
interface FumeeParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  frame: number;
  maxFrames: number;
  alive: boolean;
  anim: FrameAnimatedSprite;
}

/**
 * Custom particle for fumee2 (large smoke on impact)
 * Physics from DefineSprite_11_fumee2/frame_1/DoAction.as
 */
interface Fumee2Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  frame: number;
  maxFrames: number;
  alive: boolean;
  anim: FrameAnimatedSprite;
}

export class Spell2012 extends BaseSpell {
  readonly spellId = 2012;

  private shootAnim!: FrameAnimatedSprite;
  private fumeeParticles: FumeeParticle[] = [];
  private fumee2Particles: Fumee2Particle[] = [];
  private fumeeTextures: Texture[] = [];
  private fumee2Textures: Texture[] = [];
  private fumeeAnchor = { x: 0, y: 0 };
  private fumee2Anchor = { x: 0, y: 0 };
  private fumeeScale = 1;

  // For move sprite trail: track previous position each frame
  private moveX = 0;
  private moveY = 0;
  private prevMoveX = 0;
  private prevMoveY = 0;
  private moveFrameCounter = 0;
  private shootComplete = false;

  // Particle containers
  private fumeeContainer!: Container;
  private fumee2Container!: Container;

  // nf = 5 particles per frame for fumee trail
  private readonly NF = 5;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.fumeeTextures = textures.getFrames('lib_fumee');
    this.fumee2Textures = textures.getFrames('lib_fumee2');

    const fumeeManifestAnchor = calculateAnchor(FUMEE_MANIFEST);
    this.fumeeAnchor = fumeeManifestAnchor;

    const fumee2ManifestAnchor = calculateAnchor(FUMEE2_MANIFEST);
    this.fumee2Anchor = fumee2ManifestAnchor;

    this.fumeeScale = init.scale;

    // Particle containers (below shoot)
    this.fumeeContainer = new Container();
    this.container.addChild(this.fumeeContainer);

    this.fumee2Container = new Container();
    this.container.addChild(this.fumee2Container);

    // shoot animation at target position
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): spawn fumee2 particles
    this.shootAnim.onFrame(0, () => this.spawnFumee2Particles(init.targetX, init.targetY));

    // Frame 73 (0-indexed: 72): animation ends (removeMovieClip)
    this.shootAnim.stopAt(72);

    this.container.addChild(this.shootAnim.sprite);

    // Signal hit at start of impact (frame 0 of shoot = impact)
    this.shootAnim.onFrame(0, () => this.signalHit());

    // Initialize move position at caster
    this.moveX = 0;
    this.moveY = init.casterY;
    this.prevMoveX = this.moveX;
    this.prevMoveY = this.moveY;
  }

  /**
   * Spawn fumee2 particles (large smoke puffs on impact)
   * From DefineSprite_3_shoot/frame_1/DoAction.as:
   *   p = 0; while(p < 7) { attachMovie("fumee2",...) }
   *   f._x = this._x; f._y = this._y - 30
   *   f.vx = this._x - xi + 5 * (Math.random() - 0.5)
   *   f.vy = -7 * Math.random()
   *
   * Then in DefineSprite_11_fumee2/frame_1/DoAction.as (applied to each fumee2):
   *   t = 20 * Math.random() + 80
   *   gotoAndPlay(random(45))
   *   vx *= 0.67; vy *= 0.67
   *   onEnterFrame: _X += vx; _Y += vy; vy += 0.5
   */
  private spawnFumee2Particles(targetX: number, targetY: number): void {
    let xi = targetX;

    for (let p = 0; p < 7; p++) {
      const fX = targetX;
      const fY = targetY - 30 * this.fumeeScale;

      // vx = this._x - xi + 5 * (Math.random() - 0.5)
      // For first iteration xi = targetX so vx = 5*(rand-0.5)
      const rawVx = (targetX - xi) / this.fumeeScale + 5 * (Math.random() - 0.5);
      const rawVy = -7 * Math.random();

      // fumee2 onLoad: vx *= 0.67; vy *= 0.67
      const vx = rawVx * 0.67 * this.fumeeScale;
      const vy = rawVy * 0.67 * this.fumeeScale;

      // t = 20 * Math.random() + 80  (scale percentage)
      const t = 20 * Math.random() + 80;
      const scale = (t / 100) * this.fumeeScale;

      // gotoAndPlay(random(45)) -> startFrame = Math.floor(Math.random() * 45)
      const startFrame = Math.floor(Math.random() * 45);

      const anim = new FrameAnimatedSprite({
        textures: this.fumee2Textures,
        anchorX: this.fumee2Anchor.x,
        anchorY: this.fumee2Anchor.y,
        scale,
        startFrame,
      });

      anim.sprite.position.set(fX, fY);
      this.fumee2Container.addChild(anim.sprite);

      const particle: Fumee2Particle = {
        x: fX,
        y: fY,
        vx,
        vy,
        frame: startFrame,
        maxFrames: 51, // fumee2 has 51 frames, dies at frame 49 (0-indexed: 48)
        alive: true,
        anim,
      };

      this.fumee2Particles.push(particle);

      xi = targetX;
    }
  }

  /**
   * Spawn fumee particles (small smoke trail)
   * From DefineSprite_6_move/frame_1/DoAction.as (onEnterFrame):
   *   while(loc3 < nf) {
   *     attachMovie("fumee", ...)
   *     loc2._x = this._x; loc2._y = this._y
   *     loc2.vx = this._x - xi + 6.67 * (Math.random() - 0.5)
   *     loc2.vy = this._y - yi + 6.67 * (Math.random() - 0.5)
   *   }
   *   xi = this._x; yi = this._y
   *
   * Then in DefineSprite_13_fumee/frame_1/DoAction.as:
   *   t = 50 * Math.random() + 50
   *   gotoAndPlay(random(30))
   *   vx /= 3 + 3 * Math.random()
   *   vy /= 3 + random(3)
   *   onEnterFrame: _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2
   */
  private spawnFumeeParticles(currentX: number, currentY: number): void {
    for (let i = 0; i < this.NF; i++) {
      const fX = currentX;
      const fY = currentY;

      // vx = this._x - xi + 6.67 * (Math.random() - 0.5)
      const rawVx = (currentX - this.prevMoveX) / this.fumeeScale + 6.67 * (Math.random() - 0.5);
      const rawVy = (currentY - this.prevMoveY) / this.fumeeScale + 6.67 * (Math.random() - 0.5);

      // fumee onLoad: vx /= 3 + 3*Math.random(); vy /= 3 + random(3)
      const vxDivisor = 3 + 3 * Math.random();
      const vyDivisor = 3 + Math.floor(Math.random() * 3);
      const vx = (rawVx / vxDivisor) * this.fumeeScale;
      const vy = (rawVy / vyDivisor) * this.fumeeScale;

      // t = 50 * Math.random() + 50
      const t = 50 * Math.random() + 50;
      const scale = (t / 100) * this.fumeeScale;

      // gotoAndPlay(random(30)) -> startFrame = Math.floor(Math.random() * 30)
      const startFrame = Math.floor(Math.random() * 30);

      const anim = new FrameAnimatedSprite({
        textures: this.fumeeTextures,
        anchorX: this.fumeeAnchor.x,
        anchorY: this.fumeeAnchor.y,
        scale,
        startFrame,
      });

      anim.sprite.position.set(fX, fY);
      this.fumeeContainer.addChild(anim.sprite);

      const particle: FumeeParticle = {
        x: fX,
        y: fY,
        vx,
        vy,
        frame: startFrame,
        maxFrames: 48, // fumee has 48 frames, dies at frame 46 (0-indexed: 45)
        alive: true,
        anim,
      };

      this.fumeeParticles.push(particle);
    }
  }

  private updateFumeeParticles(): void {
    for (const p of this.fumeeParticles) {
      if (!p.alive) {
        continue;
      }

      // onEnterFrame: _X += vx; _Y += vy; vx /= 1.2; vy /= 1.2
      p.x += p.vx;
      p.y += p.vy;
      p.vx /= 1.2;
      p.vy /= 1.2;

      p.anim.sprite.position.set(p.x, p.y);

      p.frame++;

      // Dies at frame 46 (0-indexed: 45) via removeMovieClip
      if (p.frame >= 46) {
        p.alive = false;
        p.anim.sprite.visible = false;
      }
    }
  }

  private updateFumee2Particles(): void {
    for (const p of this.fumee2Particles) {
      if (!p.alive) {
        continue;
      }

      // onEnterFrame: _X += vx; _Y += vy; vy += 0.5
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.5 * this.fumeeScale;

      p.anim.sprite.position.set(p.x, p.y);

      p.frame++;

      // Dies at frame 49 (0-indexed: 48) via removeMovieClip
      if (p.frame >= 49) {
        p.alive = false;
        p.anim.sprite.visible = false;
      }
    }
  }

  private hasFumeeAlive(): boolean {
    return this.fumeeParticles.some(p => p.alive);
  }

  private hasFumee2Alive(): boolean {
    return this.fumee2Particles.some(p => p.alive);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update fumee particle animations
    for (const p of this.fumeeParticles) {
      if (p.alive) {
        p.anim.update(deltaTime);
      }
    }

    // Update fumee2 particle animations
    for (const p of this.fumee2Particles) {
      if (p.alive) {
        p.anim.update(deltaTime);
      }
    }

    // Update fumee physics (one physics step per update, matching AS enterFrame)
    this.updateFumeeParticles();
    this.updateFumee2Particles();

    // The "move" sprite spawns fumee particles each frame until shoot ends
    // The move sprite travels from caster to target over the shoot animation duration
    // We simulate it moving along the path and spawning smoke each frame
    if (!this.shootAnim.isStopped() && !this.shootAnim.isComplete()) {
      // Spawn fumee trail particles at current move position
      this.spawnFumeeParticles(this.moveX, this.moveY);
      this.prevMoveX = this.moveX;
      this.prevMoveY = this.moveY;
      this.moveFrameCounter++;
    }

    // Check if shoot is done (stopped at frame 72)
    if ((this.shootAnim.isStopped() || this.shootAnim.isComplete()) && !this.shootComplete) {
      this.shootComplete = true;
    }

    // Complete when shoot is done and all particles have died
    if (this.shootComplete && !this.hasFumeeAlive() && !this.hasFumee2Alive()) {
      this.complete();
    }
  }

  destroy(): void {
    for (const p of this.fumeeParticles) {
      p.anim.destroy();
    }
    this.fumeeParticles = [];

    for (const p of this.fumee2Particles) {
      p.anim.destroy();
    }
    this.fumee2Particles = [];

    super.destroy();
  }
}
