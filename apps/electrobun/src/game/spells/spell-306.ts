/**
 * Spell 306 - Lakam
 *
 * A spell with a shoot animation and stone particles spawned at the target.
 *
 * Components:
 * - shoot (sprite_6_shoot): Main animation at target position, 75 frames
 *   - Stops at frame 73 (AS frame 73 → index 72)
 *   - DefineSprite_23: signals hit at frame 16 (index 15), stops at frame 115 (index 114)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'lakam_405'
 * - Frame 16 (DefineSprite_23): this.end() → signal hit
 * - Frame 73 (DefineSprite_6_shoot): removeMovieClip / stop
 * - Frame 115 (DefineSprite_23): stop
 *
 * Particles (DefineSprite_5 spawner):
 * - A spawner inside the shoot clip attaches up to 6 "pierres" instances
 *   (one per frame for 6 frames)
 * - Each pierre has random position offset, velocity, gravity, and bounce physics
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
import { Texture } from "pixi.js";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 65.9,
  height: 65.9,
  offsetX: -39.4,
  offsetY: -52.95,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 40.2,
  height: 14.95,
  offsetX: 45.75,
  offsetY: -4.7,
};

export class Spell306 extends BaseSpell {
  readonly spellId = 306;

  private shootAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  // Particle spawner state
  private spawnCount = 0;
  private maxSpawns = 6;
  private particleSpawnFrameAccum = 0;
  private particleFrameTime = 1000 / 60;
  private spawningDone = false;

  // Per-particle physics state (AS enterFrame simulation)
  private particleStates: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    lim: number;
    rotation: number;
  }> = [];

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Main shoot animation at target position
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        fps: 60,
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Sound at frame 0 (AS frame 1)
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound("lakam_405");
    });

    // Hit signal at frame 15 (AS DefineSprite_23 frame 16 → this.end())
    this.shootAnim.onFrame(15, () => {
      this.signalHit();
    });

    // Stop at frame 72 (AS frame 73 → removeMovieClip/stop)
    this.shootAnim.stopAt(72);

    this.container.addChild(this.shootAnim.sprite);

    // Particle system for "pierres" stones
    const pierresTexture = textures.hasTexture("lib_pierres_0")
      ? textures.getTexture("lib_pierres_0")
      : (textures.getFrames("lib_pierres")[0] ?? Texture.EMPTY);

    this.particles = new ASParticleSystem(pierresTexture);
    this.particles.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particles.container);
  }

  /**
   * Spawn a single "pierres" particle with AS physics
   *
   * AS onClipEvent(load):
   *   _X = (Math.random() - 0.5) * 10;
   *   _Y = (Math.random() - 0.5) * 10;
   *   vx = (Math.random() - 0.5) * 3.5;
   *   vy = (-Math.random()) * 7.5;
   *   lim = 50 + (Math.random() - 0.5) * 20;
   *   _rotation = Math.atan2(vy, vx) * 57.29746936176985;
   */
  private spawnPierre(): void {
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);
    const x = (Math.random() - 0.5) * 10;
    const y = (Math.random() - 0.5) * 10;
    const vx = (Math.random() - 0.5) * 3.5;
    const vy = -Math.random() * 7.5;
    const lim = 50 + (Math.random() - 0.5) * 20;
    const rotation = Math.atan2(vy, vx) * 57.29746936176985;

    // Track state for this particle (index = this.particleStates.length)
    this.particleStates.push({ x, y, vx, vy, lim, rotation });

    // Spawn via ASParticleSystem with initial position
    // We'll manage physics manually each frame (AS enterFrame)
    this.particles.spawn({
      x,
      y,
      vx: 0,
      vy: 0,
      accX: 1,
      accY: 1,
      vr: 0,
      vrDecay: 1,
      t:
        100 *
        (1 /
          Math.max(
            (-pierresAnchor.x * PIERRES_MANIFEST.width) /
              PIERRES_MANIFEST.width,
            0.01
          )),
      vt: 0,
      vtDecay: 0,
      rotation,
      alpha: 1,
    });

    // Override the particle's initial scale using anchor-based approach
    // The sprite was just spawned as the last particle - set it up directly
    // We'll handle position/rotation manually in updateParticles
  }

  /**
   * Update particle physics per AS onClipEvent(enterFrame):
   *   _X = _X + vx;
   *   _Y = _Y + (vy += 0.3);
   *   if(_Y > lim) {
   *     _Y = lim;
   *     vy = (-vy) * 0.6;
   *     vx *= 0.6;
   *   }
   */
  private updateParticles(): void {
    // Access internal particles via the container children
    const children = this.particles.container.children;

    for (let i = 0; i < this.particleStates.length; i++) {
      const state = this.particleStates[i];
      const child = children[i];

      if (!child) {
        continue;
      }

      // AS enterFrame physics
      state.vy += 0.3;
      state.x += state.vx;
      state.y += state.vy;

      if (state.y > state.lim) {
        state.y = state.lim;
        state.vy = -state.vy * 0.6;
        state.vx *= 0.6;
      }

      child.position.set(state.x, state.y);
      child.rotation = (state.rotation * Math.PI) / 180;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Particle spawner: spawn one pierre per frame for 6 frames
    // AS DefineSprite_5 onClipEvent(enterFrame): if(c < 6) { c += 1; attachMovie(...) }
    if (!this.spawningDone) {
      this.particleSpawnFrameAccum += deltaTime;

      while (
        this.particleSpawnFrameAccum >= this.particleFrameTime &&
        this.spawnCount < this.maxSpawns
      ) {
        this.spawnCount += 1;
        this.spawnPierre();
        this.particleSpawnFrameAccum -= this.particleFrameTime;
      }

      if (this.spawnCount >= this.maxSpawns) {
        this.spawningDone = true;
      }
    }

    // Update pierre physics manually each frame
    this.updateParticles();

    // Complete when shoot animation stops
    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
