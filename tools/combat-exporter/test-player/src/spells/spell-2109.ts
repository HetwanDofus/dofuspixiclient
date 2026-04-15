/**
 * Spell 2109 - Wab (Sadida)
 *
 * A spiral projectile that travels from caster to target, leaving cercle particles
 * in its wake, with an impact animation at the target.
 *
 * Components:
 * - sprite_15: Spiral projectile, originates at caster, travels to target
 *   - Contains sprite_12 (inner animation) with enterFrame spiral motion physics
 *   - Spawns "cercle" particles along its path (DefineSprite_13 logic)
 *   - Stops at frame 27 (AS frame 28 = removeMovieClip/stop)
 * - sprite_22: Impact animation at target position, signals hit at frame 54 (AS frame 55),
 *   stops at frame 81 (AS frame 82)
 *
 * Original AS timing:
 * - Frame 1 (sprite_15): Play sound 'wab_swirl'
 * - Frame 1 (sprite_15): Initialize spiral motion (d = half-distance, rotation = angle to target)
 * - Each frame: Spiral object moves in parametric orbit, spawning cercle particles
 * - Frame 28 (sprite_15): removeMovieClip() + stop() — projectile done
 * - Frame 55 (sprite_22): this.end() — signal hit
 * - Frame 82 (sprite_22): stop()
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

const SPRITE_15_MANIFEST: SpriteManifest = {
  width: 32.75,
  height: 27.25,
  offsetX: -16.35,
  offsetY: -17.65,
};

const SPRITE_22_MANIFEST: SpriteManifest = {
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

/**
 * Spiral physics state (replicates DefineSprite_15 frame_1 PlaceObject2_13_1 enterFrame logic)
 */
interface SpiralState {
  pi: number;
  v: number;
  size: number;
  a: number;
  b: number;
  t: number;
  nFramesToIgnore: number;
  nCurrentFrameState: number;
  d: number; // half-distance
  localX: number; // current local X within sprite_15
  localY: number; // current local Y within sprite_15
  previousWorldX: number; // for tracking movement for cercle particles
  previousWorldY: number;
  active: boolean;
  triggered: boolean; // whether sprite_15 has started playing (gotoAndPlay(2))
}

export class Spell2109 extends BaseSpell {
  readonly spellId = 2109;

  private impactAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  // Sprite_15 container (the spiral projectile)
  private sprite15Container!: Container;
  private sprite15Anim!: FrameAnimatedSprite;
  private sprite15Active = true;

  // Spiral state from DefineSprite_13 / DefineSprite_15 PlaceObject2_13_1
  private spiral!: SpiralState;

  // Cercle particle counter (starts at 100 per AS)
  private cercleCounter = 100;

  // World position of the sprite_15 container (needed to compute particle world coords)
  private sprite15WorldX = 0;
  private sprite15WorldY = 0;
  private sprite15Rotation = 0; // in radians

  // Running time accumulator for frame-rate-independent spiral stepping
  private spiralFrameAccumulator = 0;
  private readonly FRAME_TIME = 1000 / 60;

  // Track whether sprite_15 has been removed
  private sprite15Removed = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const cellFromX = context?.cellFrom?.x ?? 0;
    const cellFromY = context?.cellFrom?.y ?? 0;
    const cellToX = context?.cellTo?.x ?? 0;
    const cellToY = context?.cellTo?.y ?? 0;

    const dx = cellToX - cellFromX;
    const dy = cellToY - cellFromY;
    const d = Math.sqrt(dx * dx + dy * dy) / 2;
    const rotationRad = Math.atan2(dy, dx);

    // ---- sprite_15 (spiral projectile) ----
    const sprite15Anchor = calculateAnchor(SPRITE_15_MANIFEST);

    // The sprite_15 in AS is positioned at cellFrom (absolute world),
    // but our container is relative to cellFrom, so it's at (0, 0).
    this.sprite15Container = new Container();
    this.sprite15Container.position.set(0, 0);
    this.container.addChild(this.sprite15Container);

    // The sprite_15 animation plays until frame 27 (0-indexed), then stops
    this.sprite15Anim = new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_15'),
      anchorX: sprite15Anchor.x,
      anchorY: sprite15Anchor.y,
      scale: init.scale,
    });

    // AS frame 1: play sound
    this.sprite15Anim.onFrame(0, () => {
      this.callbacks.playSound('wab_swirl');
    });

    // AS frame 28 (0-indexed: 27): removeMovieClip() + stop()
    this.sprite15Anim.stopAt(27);
    this.sprite15Anim.onFrame(27, () => {
      this.sprite15Removed = true;
      this.sprite15Container.visible = false;
    });

    this.sprite15Container.addChild(this.sprite15Anim.sprite);

    // Initialize spiral state (DefineSprite_15 frame_1 PlaceObject2_13_1 onClipEvent load)
    // size = 0.8 + 3 * Math.random()
    const spiralSize = 0.8 + 3 * Math.random();
    this.spiral = {
      pi: 3.1415,
      v: 0.3,
      size: spiralSize,
      a: 0,
      b: 0,
      t: 0,
      nFramesToIgnore: 2,
      nCurrentFrameState: 0,
      d,
      // Initial position from DoAction_2.as:
      // _X = d + d * Math.cos(pi + a)  where a=0 => d + d * cos(pi) = d - d = 0
      // _Y = d * Math.sin(0) / size = 0
      localX: d + d * Math.cos(3.1415 + 0),
      localY: d * Math.sin(0) / spiralSize,
      previousWorldX: 0,
      previousWorldY: 0,
      active: true,
      triggered: false,
    };

    // Store world position for sprite_15 (it sits at cellFrom in world space)
    this.sprite15WorldX = 0; // relative to container which is at cellFrom
    this.sprite15WorldY = 0;
    this.sprite15Rotation = rotationRad;

    // Apply rotation from DoAction_2: _rotation = Math.atan2(dy, dx) * 180 / 3.1415
    this.sprite15Container.rotation = rotationRad;

    // Compute initial world position of spiral object for particle tracking
    const initWorld = this.spiralLocalToWorld(this.spiral.localX, this.spiral.localY);
    this.spiral.previousWorldX = initWorld.wx;
    this.spiral.previousWorldY = initWorld.wy;

    // ---- Particle system (cercle) ----
    const cercleTextures = textures.getFrames('lib_cercle');
    const cercleTexture = cercleTextures[0] ?? textures.getTexture('lib_cercle_0');
    this.particles = new ASParticleSystem(cercleTexture);
    // Particles are in world space (relative to our container at cellFrom)
    this.container.addChildAt(this.particles.container, 0);

    // ---- sprite_22 (impact at target) ----
    const sprite22Anchor = calculateAnchor(SPRITE_22_MANIFEST);

    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_22'),
      anchorX: sprite22Anchor.x,
      anchorY: sprite22Anchor.y,
      scale: init.scale,
    }));

    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    // Relative to our container (which is at cellFrom), target is at:
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);

    // AS frame 55 (0-indexed: 54): this.end() — signal hit
    this.impactAnim.onFrame(54, () => {
      this.signalHit();
    });

    // AS frame 82 (0-indexed: 81): stop()
    this.impactAnim.stopAt(81);

    this.container.addChild(this.impactAnim.sprite);
  }

  /**
   * Convert spiral local coordinates (within sprite_15's rotated frame) to
   * world coordinates relative to our main container.
   */
  private spiralLocalToWorld(lx: number, ly: number): { wx: number; wy: number } {
    const cos = Math.cos(this.sprite15Rotation);
    const sin = Math.sin(this.sprite15Rotation);
    // sprite_15 container is at (0, 0) in our main container space
    const wx = this.sprite15WorldX + lx * cos - ly * sin;
    const wy = this.sprite15WorldY + lx * sin + ly * cos;
    return { wx, wy };
  }

  /**
   * Advance the spiral physics by one frame.
   * Replicates DefineSprite_15/frame_1/PlaceObject2_13_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
   */
  private updateSpiralOneFrame(): void {
    const s = this.spiral;

    if (s.t > 28) {
      // AS: _parent.gotoAndPlay(2) — sprite_15 starts playing from frame 2
      // In our implementation, sprite_15Anim is already playing; we just mark triggered
      if (!s.triggered) {
        s.triggered = true;
        // The sprite_15 animation should already be running; nothing extra needed
      }
    } else if (s.nCurrentFrameState > 0) {
      // Sub-frame interpolation step
      s.b = s.a;
      s.b += s.v / 3;
      s.localX = s.d + s.d * Math.cos(s.pi + s.b);
      s.localY = s.d * Math.sin(s.b) / s.size;
      s.nCurrentFrameState--;
    } else {
      // Main frame step
      s.localX = s.d + s.d * Math.cos(s.pi + s.a);
      s.localY = s.d * Math.sin(s.a) / s.size;
      s.a += s.v;
      s.t++;

      if (s.t <= 14) {
        s.v -= 0.015;
      } else {
        s.v += 0.03;
      }

      s.nCurrentFrameState = s.nFramesToIgnore;
    }
  }

  /**
   * Spawn a cercle particle at current spiral position.
   * Replicates DefineSprite_13 frame_1 DoAction (the onEnterFrame handler).
   *
   * The cercle particle has its own enterFrame logic from:
   * DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
   * DefineSprite_7_cercle/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
   */
  private spawnCercleParticle(wx: number, wy: number, vx: number, vy: number): void {
    // DefineSprite_7_cercle onClipEvent(load):
    // va = 8 - random(3)  [0,1,2 -> values 8,7,6]
    // t = 60 + random(70) [60..129]
    // _xscale = t; _yscale = t
    // _alpha = 90 + random(30) [90..119, but alpha is 0-100 in AS, >100 = 100]
    // r = 1.3 + 0.5 * Math.random()

    const va = 8 - Math.floor(Math.random() * 3); // alpha decay per frame
    const t = 60 + Math.floor(Math.random() * 70); // initial scale (as percentage)
    const alpha = Math.min(100, 90 + Math.floor(Math.random() * 30)) / 100; // clamp to 1.0
    const r = 1.3 + 0.5 * Math.random(); // friction for velocity

    // The cercle particle: each frame reduces alpha by va, moves by vx/vy, then divides vx/vy by r
    // We model this using ASParticleSystem with alphaVelocity, but the friction on velocity
    // is more complex (division rather than multiplication). We'll handle it manually via
    // a custom update approach. Since ASParticleSystem uses accX/accY as multipliers,
    // we can set accX = 1/r and accY = 1/r to replicate "_parent.vx /= r".

    this.particles.spawn({
      x: wx,
      y: wy,
      vx: vx,
      vy: vy,
      accX: 1 / r,
      accY: 1 / r,
      vr: 0,
      vrDecay: 1,
      t: t,
      vt: 0,
      vtDecay: 0,
      rotation: 0,
      alpha: alpha,
      alphaVelocity: -(va / 100), // per-frame alpha reduction (va is in % units)
      gravity: 0,
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update spiral physics (frame-rate independent, one step per 1/60s)
    if (this.spiral.active && !this.sprite15Removed) {
      this.spiralFrameAccumulator += deltaTime;

      while (this.spiralFrameAccumulator >= this.FRAME_TIME) {
        this.spiralFrameAccumulator -= this.FRAME_TIME;

        if (!this.sprite15Removed) {
          this.updateSpiralOneFrame();

          // Compute current world position
          const world = this.spiralLocalToWorld(this.spiral.localX, this.spiral.localY);

          // Velocity = movement since last frame (replicates DefineSprite_13's vx/vy calculation)
          const vx = world.wx - this.spiral.previousWorldX;
          const vy = world.wy - this.spiral.previousWorldY;

          // Spawn cercle particle at current position
          this.spawnCercleParticle(world.wx, world.wy, vx, vy);
          this.cercleCounter++;

          this.spiral.previousWorldX = world.wx;
          this.spiral.previousWorldY = world.wy;
        }
      }
    }

    // Update sprite_15 animation (managed manually, not via this.anims)
    if (!this.sprite15Removed) {
      this.sprite15Anim.update(deltaTime);
    }

    // Update impact animation
    this.anims.update(deltaTime);

    // Update particles
    this.particles.update();

    // Check completion: impact animation stopped AND no alive particles
    if (this.impactAnim.isStopped() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    if (!this.sprite15Removed) {
      this.sprite15Anim.destroy();
    }
    super.destroy();
  }
}
