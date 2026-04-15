/**
 * Spell 2011 - Larve Tir
 *
 * A projectile spell with smoke trail particles (fumee/fumee2).
 *
 * Components:
 * - shoot (sprite_4): Main projectile animation at caster position, rotated toward target
 *   - At frame 1 (0-indexed 0): spawns 3 fumee2 particles at start position
 *   - At frame 37 (0-indexed 36): spawns 9 more fumee2 particles at current position
 *   - At frame 91 (0-indexed 90): removeMovieClip / animation ends
 * - move (sprite_8): A child of shoot that emits fumee smoke particles each frame
 * - fumee particles: small smoke puffs with gentle drift
 * - fumee2 particles: larger smoke puffs with stronger initial velocity
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'larve_tir'
 * - Frame 1 (shoot): Spawn 3 fumee2 particles; set up move's onEnterFrame to spawn fumee
 * - Frame 37 (shoot): Spawn 9 fumee2 particles
 * - Frame 91 (shoot): removeMovieClip - animation ends
 * - Frame 46 (fumee): removeMovieClip
 * - Frame 49 (fumee2): removeMovieClip
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

const SHOOT_MANIFEST: SpriteManifest = {
  width: 132.8,
  height: 88.75,
  offsetX: -77.4,
  offsetY: -75.2,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 2.35,
  height: 5.5,
  offsetX: -3.05,
  offsetY: 0,
};

const FUMEE2_MANIFEST: SpriteManifest = {
  width: 13.25,
  height: 9.8,
  offsetX: -8.45,
  offsetY: -7.3,
};

interface ActiveParticle {
  anim: FrameAnimatedSprite;
  vx: number;
  vy: number;
  /** fumee: friction = 1.067, fumee2: friction = 1.1 */
  friction: number;
  alive: boolean;
}

export class Spell2011 extends BaseSpell {
  readonly spellId = 2011;

  private shootAnim!: FrameAnimatedSprite;
  private particlesContainer!: Container;
  private activeParticles: ActiveParticle[] = [];
  private fumeeTextures: Texture[] = [];
  private fumee2Textures: Texture[] = [];
  private fumeeAnchor = { x: 0, y: 0 };
  private fumee2Anchor = { x: 0, y: 0 };
  private level = 1;

  // Track shoot sprite position for particle spawning
  private shootX = 0;
  private shootY = 0;
  // Previous shoot position (for velocity calculation)
  private shootPrevX = 0;
  private shootPrevY = 0;

  // Has frame-37 particles been spawned?
  private frame37Spawned = false;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    this.fumeeTextures = textures.getFrames("lib_fumee");
    this.fumee2Textures = textures.getFrames("lib_fumee2");
    this.fumeeAnchor = calculateAnchor(FUMEE_MANIFEST);
    this.fumee2Anchor = calculateAnchor(FUMEE2_MANIFEST);

    // Container for all particles (below shoot)
    this.particlesContainer = new Container();
    this.particlesContainer.scale.set(init.scale);
    this.container.addChild(this.particlesContainer);

    // Shoot animation at caster position, rotated toward target
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        fps: 20,
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Sound at frame 0 (AS frame 1)
    this.shootAnim.onFrame(0, () => this.callbacks.playSound("larve_tir"));

    // Hit signal: the projectile reaches target around frame 37 (when it spawns impact particles)
    // Frame 37 (AS) = frame 36 (0-indexed)
    this.shootAnim.onFrame(36, () => this.signalHit());

    // Stop at frame 90 (AS frame 91)
    this.shootAnim.stopAt(90);

    this.container.addChild(this.shootAnim.sprite);

    // Initial shoot position (in unscaled space, matching particle container's space)
    this.shootX = 0;
    this.shootY = init.casterY;
    this.shootPrevX = this.shootX;
    this.shootPrevY = this.shootY;

    // Spawn initial 3 fumee2 particles at frame 1 (index 0) of shoot
    // AS: while(p < 3) { attachMovie("fumee2", ...) }
    this.spawnFumee2Particles(3);
  }

  private spawnFumee2Particles(count: number): void {
    // AS DefineSprite_4_shoot/frame_1 and frame_37:
    // f._x = this._x; f._y = this._y - 30;
    // f.vx = this._x - xi + 6.67 * (Math.random() - 0.5)
    // f.vy = this._y - yi + 6.67 * (Math.random() - 0.5)
    // xi and yi update each iteration

    let xi = this.shootPrevX;
    let yi = this.shootPrevY;

    for (let p = 0; p < count; p++) {
      const f = new FrameAnimatedSprite({
        textures: this.fumee2Textures,
        fps: 20,
        anchorX: this.fumee2Anchor.x,
        anchorY: this.fumee2Anchor.y,
      });

      const spawnX = this.shootX;
      const spawnY = this.shootY - 30;

      // AS: f.vx = this._x - xi + 6.67 * (Math.random() - 0.5)
      let vx = this.shootX - xi + 6.67 * (Math.random() - 0.5);
      let vy = this.shootY - yi + 6.67 * (Math.random() - 0.5);

      // AS DefineSprite_14_fumee2/frame_1:
      // t = 20 * Math.random() + 80
      // gotoAndPlay(random(45))
      // _xscale = t; _yscale = t
      // vx *= 2; vy *= 2
      const t = 20 * Math.random() + 80;
      const startFrame = Math.floor(Math.random() * 45);
      const scale = t / 100;

      vx *= 2;
      vy *= 2;

      f.sprite.position.set(spawnX, spawnY);
      f.sprite.scale.set(scale);

      // fumee2 dies at AS frame 49 = 0-indexed 48, stop at 48
      f.stopAt(48);
      f.gotoFrame(startFrame);

      this.particlesContainer.addChild(f.sprite);

      const particle: ActiveParticle = {
        anim: f,
        vx,
        vy,
        friction: 1.1,
        alive: true,
      };

      this.activeParticles.push(particle);

      // Update xi/yi for next iteration (AS does this inside loop)
      xi = this.shootX;
      yi = this.shootY;
    }
  }

  private spawnFumeeParticles(count: number): void {
    // AS DefineSprite_8_move/frame_1 onEnterFrame:
    // attachMovie("fumee", ...)
    // _loc2_._x = this._x; _loc2_._y = this._y
    // _loc2_.vx = this._x - xi + 6.67 * (Math.random() - 0.5)
    // _loc2_.vy = this._y - yi + 6.67 * (Math.random() - 0.5)

    for (let i = 0; i < count; i++) {
      const f = new FrameAnimatedSprite({
        textures: this.fumeeTextures,
        fps: 20,
        anchorX: this.fumeeAnchor.x,
        anchorY: this.fumeeAnchor.y,
      });

      // AS DefineSprite_15_fumee/frame_1:
      // t = 50 * Math.random() + 50
      // gotoAndPlay(random(30))
      // _xscale = t; _yscale = t
      // vx /= 3 + 3 * Math.random()
      // vy /= 3 + random(3)
      const t = 50 * Math.random() + 50;
      const startFrame = Math.floor(Math.random() * 30);
      const scale = t / 100;

      let vx = this.shootX - this.shootPrevX + 6.67 * (Math.random() - 0.5);
      let vy = this.shootY - this.shootPrevY + 6.67 * (Math.random() - 0.5);

      vx /= 3 + 3 * Math.random();
      vy /= 3 + Math.floor(Math.random() * 3);

      f.sprite.position.set(this.shootX, this.shootY);
      f.sprite.scale.set(scale);

      // fumee dies at AS frame 46 = 0-indexed 45, stop at 45
      f.stopAt(45);
      f.gotoFrame(startFrame);

      this.particlesContainer.addChild(f.sprite);

      const particle: ActiveParticle = {
        anim: f,
        vx,
        vy,
        friction: 1.067,
        alive: true,
      };

      this.activeParticles.push(particle);
    }
  }

  private updateParticles(deltaTime: number): void {
    for (const p of this.activeParticles) {
      if (!p.alive) {
        continue;
      }

      p.anim.update(deltaTime);

      if (p.anim.isComplete() || p.anim.isStopped()) {
        p.alive = false;
        p.anim.sprite.visible = false;
        continue;
      }

      // Apply physics each frame-step
      // AS: _X += vx; _Y += vy; vx /= friction; vy /= friction
      p.anim.sprite.x += p.vx;
      p.anim.sprite.y += p.vy;
      p.vx /= p.friction;
      p.vy /= p.friction;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    const prevFrame = this.shootAnim.getFrame();
    this.shootAnim.update(deltaTime);
    const currentFrame = this.shootAnim.getFrame();

    // Track shoot sprite position in unscaled particle space
    this.shootPrevX = this.shootX;
    this.shootPrevY = this.shootY;
    this.shootX = this.shootAnim.sprite.x;
    this.shootY = this.shootAnim.sprite.y;

    // Frame 37 (0-indexed 36): spawn 9 fumee2 particles
    if (!this.frame37Spawned && currentFrame >= 36 && prevFrame < 36) {
      this.frame37Spawned = true;
      this.spawnFumee2Particles(9);
    }

    // The "move" sprite spawns fumee particles each frame (onEnterFrame)
    // nf = level * 1; spawns nf fumee particles per frame
    const nf = this.level * 1;
    this.spawnFumeeParticles(nf);

    // Update all particles
    this.updateParticles(deltaTime);

    // Check completion: shoot stopped at frame 90 and all particles done
    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      const anyAlive = this.activeParticles.some((p) => p.alive);
      if (!anyAlive) {
        this.complete();
      }
    }
  }

  destroy(): void {
    for (const p of this.activeParticles) {
      p.anim.destroy();
    }
    this.activeParticles = [];
    super.destroy();
  }
}
