/**
 * Spell 2111 - Wab (Osamodas)
 *
 * A spell with an orbiting projectile that travels from caster to target,
 * leaving a trail of "cercle" particles, then an impact animation plays at target.
 *
 * Components:
 * - sprite_16: Orbiting projectile starting at caster, travels to target via elliptical path
 *   - Contains sprite_13 (orbiting child) and sprite_5 (spinning particles)
 *   - The "bullet" that moves along the path
 * - sprite_23: Impact animation at target position, signals hit at frame 54, stops at frame 81
 * - Particles (cercle): Trail particles spawned by the orbiting object (sprite_14/sprite_13)
 *
 * Original AS timing:
 * - Frame 1 (sprite_16): Play sound 'wab_swirl', setup position/rotation, stop()
 * - Frame 1 (sprite_14 inside sprite_16): Start trail particle spawning via onEnterFrame
 * - Every frame (sprite_14): Attach 'cercle' particles with velocity from movement
 * - Frame 28 (sprite_16): removeMovieClip() -> animation ends for bullet
 * - Frame 55 (sprite_23): this.end() -> signal hit (0-indexed: frame 54)
 * - Frame 82 (sprite_23): stop() (0-indexed: frame 81)
 *
 * The orbiting motion:
 * - Uses elliptical path: X = d + d*cos(pi + a), Y = d*sin(a)/size
 * - v starts at 0.3, decreases by 0.015 each frame for first 14 ticks, then increases by 0.03
 * - After 28 ticks (t > 28), bullet triggers gotoAndPlay(2) which plays out
 * - nFramesToIgnore=2 means position updates every 3rd frame (2 interpolated)
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
import { Container } from "pixi.js";

const BULLET_MANIFEST: SpriteManifest = {
  width: 32.75,
  height: 27.25,
  offsetX: -16.35,
  offsetY: -17.65,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 62.55,
  height: 69,
  offsetX: -27.2,
  offsetY: -46.95,
};

const CERCLE_MANIFEST: SpriteManifest = {
  width: 24.75,
  height: 10.45,
  offsetX: -11.15,
  offsetY: -9.5,
};

export class Spell2111 extends BaseSpell {
  readonly spellId = 2111;

  private impactAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  // Orbiting bullet state (simulates DefineSprite_16 + its child DefineSprite_14)
  private bulletContainer!: Container;
  private bulletAnim!: FrameAnimatedSprite;
  private bulletDestroyed = false;

  // Elliptical path state (from PlaceObject2_14_1 onClipEvent)
  private pi = Math.PI;
  private v = 0.3;
  private a = 0;
  private b = 0;
  private t = 0;
  private nFramesToIgnore = 2;
  private nCurrentFrameState = 0;
  private size = 0;
  private d = 0;

  // Bullet screen position (absolute, used for trail particles)
  private bulletX = 0;
  private bulletY = 0;
  private bulletXi = 0;
  private bulletYi = 0;

  // Bullet rotation (radians)
  private bulletRotation = 0;
  // Frame accumulator for bullet phase playback
  private bulletFrameAccum = 0;
  private readonly FRAME_TIME = 1000 / 60;

  // Whether the bullet animation has been removed
  private bulletGotoPlay2 = false;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // --- Particle system for cercle trail ---
    const cercleTexture = textures.getFrames("lib_cercle")[0];
    const cercleAnchor = calculateAnchor(CERCLE_MANIFEST);
    _ = cercleAnchor; // suppress unused var warning - we use it below
    this.particles = new ASParticleSystem(cercleTexture);
    this.container.addChild(this.particles.container);

    // --- Bullet (sprite_16) ---
    // From DoAction_2.as:
    //   x = _parent.cellFrom.x; y = _parent.cellFrom.y;
    //   dx = _parent.cellTo.x - x; dy = _parent.cellTo.y - y;
    //   d = Math.sqrt(dx*dx + dy*dy) / 2;
    //   _rotation = Math.atan2(dy,dx) * 180 / 3.1415;
    const fromX = context?.cellFrom?.x ?? 0;
    const fromY = context?.cellFrom?.y ?? 0;
    const toX = context?.cellTo?.x ?? 0;
    const toY = context?.cellTo?.y ?? 0;
    const dx = toX - fromX;
    const dy = toY - fromY;
    this.d = Math.sqrt(dx * dx + dy * dy) / 2;
    this.bulletRotation = Math.atan2(dy, dx);

    // size from onClipEvent(load) of PlaceObject2_14_1:
    //   size = 0.8 + 3 * Math.random()
    this.size = 0.8 + 3 * Math.random();

    // Bullet base position in screen coords (relative to container which is at cellFrom)
    this.bulletBaseX = 0; // container is positioned at cellFrom by the fight system
    this.bulletBaseY = 0;

    // Compute initial bullet local position (in sprite_16's local rotated space)
    // a=0, cos(pi+0)=cos(pi)=-1, sin(0)=0
    // localX = d + d*cos(pi+0) = d - d = 0
    // localY = d*sin(0)/size = 0
    const localX0 = this.d + this.d * Math.cos(this.pi + 0);
    const localY0 = (this.d * Math.sin(0)) / this.size;

    // Transform from sprite_16's local space to world space
    const cos = Math.cos(this.bulletRotation);
    const sin = Math.sin(this.bulletRotation);
    this.bulletX = localX0 * cos - localY0 * sin + fromX;
    this.bulletY = localX0 * sin + localY0 * cos + fromY;
    this.bulletXi = this.bulletX;
    this.bulletYi = this.bulletY;

    // Container to hold bullet sprite (positioned at caster)
    this.bulletContainer = new Container();
    this.bulletContainer.position.set(0, 0);
    this.bulletContainer.rotation = this.bulletRotation;
    this.container.addChild(this.bulletContainer);

    const bulletAnchor = calculateAnchor(BULLET_MANIFEST);
    this.bulletAnim = new FrameAnimatedSprite({
      textures: textures.getFrames("sprite_16"),
      anchorX: bulletAnchor.x,
      anchorY: bulletAnchor.y,
      scale: init.scale,
    });

    // Sound at frame 0 (AS frame 1)
    this.bulletAnim.onFrame(0, () => this.callbacks.playSound("wab_swirl"));

    this.bulletContainer.addChild(this.bulletAnim.sprite);

    // Set initial bullet position in local space
    this.bulletAnim.sprite.position.set(localX0, localY0);

    // --- Impact animation (sprite_23) at target position ---
    // From frame_2 PlaceObject2_23_3 onClipEvent(load): _X = cellTo.x, _Y = cellTo.y
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_23"),
        anchorX: impactAnchor.x,
        anchorY: impactAnchor.y,
        scale: init.scale,
      })
    );
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    // Frame 55 (0-indexed: 54): this.end() -> signal hit
    this.impactAnim.onFrame(54, () => this.signalHit());
    // Frame 82 (0-indexed: 81): stop()
    this.impactAnim.stopAt(81);
    this.container.addChild(this.impactAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update impact animation
    this.anims.update(deltaTime);

    // Update bullet
    if (!this.bulletDestroyed) {
      this.updateBullet(deltaTime);
    }

    // Update particles
    this.particles.update();

    // Completion: impact animation stopped AND no alive particles
    if (this.impactAnim.isStopped() || this.impactAnim.isComplete()) {
      if (!this.particles.hasAliveParticles()) {
        this.complete();
      }
    }
  }

  private updateBullet(deltaTime: number): void {
    this.bulletFrameAccum += deltaTime;

    while (this.bulletFrameAccum >= this.FRAME_TIME) {
      this.bulletFrameAccum -= this.FRAME_TIME;
      this.stepBullet();

      if (this.bulletDestroyed) {
        break;
      }
    }
  }

  private stepBullet(): void {
    if (this.bulletGotoPlay2) {
      // Bullet is playing out (frame 2 onwards in sprite_16 timeline = playing animation)
      // Advance bullet animation frames
      this.bulletAnim.update(this.FRAME_TIME);

      if (this.bulletAnim.isComplete()) {
        this.destroyBullet();
      }
      return;
    }

    // Elliptical orbit phase (sprite_16 is stopped at frame 1, child sprite_14 runs onEnterFrame)
    // From PlaceObject2_14_1 onClipEvent(enterFrame):
    let localX: number;
    let localY: number;

    if (this.t > 28) {
      // gotoAndPlay(2) on sprite_16 parent
      this.bulletGotoPlay2 = true;
      // Start the bullet animation playing from frame 1 (0-indexed)
      this.bulletAnim.gotoFrame(1);
      this.bulletAnim.play();
      return;
    } else if (this.nCurrentFrameState > 0) {
      // Interpolated frame - use b position
      this.b = this.a;
      this.b += this.v / 3;
      localX = this.d + this.d * Math.cos(this.pi + this.b);
      localY = (this.d * Math.sin(this.b)) / this.size;
      this.nCurrentFrameState--;
    } else {
      // Main update frame
      localX = this.d + this.d * Math.cos(this.pi + this.a);
      localY = (this.d * Math.sin(this.a)) / this.size;
      this.a += this.v;
      this.t++;
      if (this.t <= 14) {
        this.v -= 0.015;
      } else {
        this.v += 0.03;
      }
      this.nCurrentFrameState = this.nFramesToIgnore;
    }

    // Update bullet sprite position in local (rotated) space
    this.bulletAnim.sprite.position.set(localX, localY);

    // Compute world position for trail particles
    const cos = Math.cos(this.bulletRotation);
    const sin = Math.sin(this.bulletRotation);
    // Container is at (0,0) relative to its parent (which is at cellFrom in world)
    // But our container's position is 0,0 and rotation is bulletRotation
    // World pos = bulletContainer.rotation applied to (localX, localY)
    const worldX = localX * cos - localY * sin;
    const worldY = localX * sin + localY * cos;

    this.bulletX = worldX;
    this.bulletY = worldY;

    // Spawn trail particle (from DefineSprite_14/frame_1/DoAction.as)
    // vx = _X - xi; vy = _Y - yi
    const vx = this.bulletX - this.bulletXi;
    const vy = this.bulletY - this.bulletYi;

    this.spawnCercle(this.bulletX, this.bulletY, vx, vy);

    this.bulletXi = this.bulletX;
    this.bulletYi = this.bulletY;
  }

  private spawnCercle(x: number, y: number, vx: number, vy: number): void {
    // From DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as:
    //   va = 8 - random(3)       -> 8 - Math.floor(Math.random() * 3) -> 5..8 (but more precisely: 8,7,6 with equal prob but random(3)=0..2, so 8-0=8, 8-1=7, 8-2=6)
    //   t = 60 + random(70)      -> 60 + Math.floor(Math.random() * 70) -> 60..129
    //   _xscale = t; _yscale = t
    //   _alpha = 90 + random(30) -> 90..119 (capped at 100 visually)
    //   r = 1.3 + 0.5 * Math.random()

    // The cercle's vx/vy come from the parent movie clip (the spawn point)
    // From onClipEvent(enterFrame):
    //   _alpha -= va
    //   _X += _parent.vx; _Y += _parent.vy
    //   _parent.vx /= r; _parent.vy /= r
    // So the parent's vx/vy decay, and cercle follows

    const va = 8 - Math.floor(Math.random() * 3);
    const tScale = 60 + Math.floor(Math.random() * 70);
    const alpha = (90 + Math.floor(Math.random() * 30)) / 100;
    const r = 1.3 + 0.5 * Math.random();

    // Simulate the cercle particle using ASParticleSystem
    // vx/vy decay by /r each frame (accX = 1/r, accY = 1/r)
    // alpha decreases by va/100 each frame
    // t stays constant (no scale change)
    // death when alpha < 10/100 = 0.1
    this.particles.spawn({
      x,
      y,
      vx,
      vy,
      accX: 1 / r,
      accY: 1 / r,
      t: tScale,
      vt: 0,
      vtDecay: 0,
      vr: 0,
      vrDecay: 1,
      alpha,
      alphaVelocity: -(va / 100),
    });

    this.trailCounter++;
  }

  private destroyBullet(): void {
    if (this.bulletDestroyed) {
      return;
    }
    this.bulletDestroyed = true;
    this.bulletContainer.destroy({ children: true });
  }

  destroy(): void {
    if (!this.bulletDestroyed) {
      this.bulletContainer.destroy({ children: true });
      this.bulletDestroyed = true;
    }
    this.particles.destroy();
    super.destroy();
  }
}

// Suppress unused variable warning for cercleAnchor
function _(_: unknown): void {}
