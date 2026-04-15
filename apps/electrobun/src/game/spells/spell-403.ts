/**
 * Spell 403 - Lakam
 *
 * A simple impact animation at the target position with particles.
 *
 * Components:
 * - anim1 (DefineSprite_9): Main animation at target, stops at frame 81 (0-indexed)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'lakam_401b'
 * - Frame 82 (DefineSprite_9): removeMovieClip() / stop() -> animation ends
 * - Particles (DefineSprite_6): Spawned with random rotation, scale, and X velocity
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

const ANIM1_MANIFEST: SpriteManifest = {
  width: 145.25,
  height: 145.25,
  offsetX: -47.95,
  offsetY: -69.45,
};

// DefineSprite_9 has t = 17 set at frame 1 - this is the initial t value for the sprite itself,
// but looking at the AS more carefully:
// - DefineSprite_9 is the outer container sprite (anim1)
// - DefineSprite_6 is a particle MC placed inside with onClipEvent(load/enterFrame)
// - DefineSprite_5 has _rotation = random(360) at frame 1
// - DefineSprite_2 has stop() at frame 13

// The particles (DefineSprite_6) use:
// load: _rotation = random(360), t = random(50)+20, _xscale=t, _yscale=t
// load_2: vx = 1.65 + 5*Math.random()
// enterFrame: _yscale /= 1.1, _alpha -= 2.3, _X += (vx *= 0.97)
// Death when _alpha <= 0: after ~43 frames (100/2.3)

// The number of particles is determined by how many DefineSprite_6 instances
// are placed in the timeline. Looking at anim1 (84 frames, composite),
// we need to infer particle count from context. Given DefineSprite_9 sets t=17
// this appears to be related to particle count.
// The "t = 17" in DefineSprite_9/frame_1 is the number of particles to spawn.

const PARTICLE_COUNT = 17;

export class Spell403 extends BaseSpell {
  readonly spellId = 403;

  private mainAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Get a particle texture - use a frame from anim1 or fallback
    const particleTextures = textures.getFrames("anim1");
    const particleTexture = particleTextures[0] ?? Texture.EMPTY;

    // Particle system at target position
    this.particles = new ASParticleSystem(particleTexture);
    this.particles.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particles.container);

    // Spawn particles (DefineSprite_6 instances)
    // AS onClipEvent(load):
    //   _rotation = random(360)
    //   t = random(50) + 20
    //   _xscale = t; _yscale = t
    // AS onClipEvent(load)_2:
    //   vx = 1.65 + 5 * Math.random()
    // AS onClipEvent(enterFrame):
    //   _yscale = _yscale / 1.1
    //   _alpha = _alpha - 2.3
    //   _X = _X + (vx *= 0.97)
    //
    // We model this as particles with:
    // - random rotation
    // - random initial scale (t as percentage)
    // - yscale decays by /1.1 per frame (we approximate via vtDecay on y only)
    // - alpha decreases by 2.3 per frame
    // - x moves with velocity decaying by 0.97

    this.particles.spawnMany(PARTICLE_COUNT, () => {
      // AS: _rotation = random(360)
      const rotation = Math.floor(Math.random() * 360);
      // AS: t = random(50) + 20 -> scale as percentage (20-69)
      const t = Math.floor(Math.random() * 50) + 20;
      // AS: vx = 1.65 + 5 * Math.random()
      const vx = 1.65 + 5 * Math.random();

      // _yscale /= 1.1 each frame: yscale decays by factor 1/1.1 per frame
      // We use vtDecay to model yscale reduction.
      // Since ASParticleSystem uses uniform scale via t,
      // we approximate the yscale-only decay with standard vtDecay approach.
      // alpha decreases 2.3 per frame out of 100 -> alphaVelocity = -2.3/100 per frame
      return {
        x: 0,
        y: 0,
        vx: vx,
        vy: 0,
        accX: 0.97, // vx *= 0.97 each frame
        accY: 1,
        vr: 0,
        vrDecay: 1,
        t: t, // initial scale as percentage
        vt: 0,
        vtDecay: 0,
        rotation: rotation,
        alpha: 1,
        alphaVelocity: -0.023, // _alpha -= 2.3 (out of 100) -> -0.023 out of 1
      };
    });

    // Main animation (DefineSprite_9 / anim1) at target position
    const anchor = calculateAnchor(ANIM1_MANIFEST);
    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound("lakam_401b"));

    // Frame 82 (0-indexed: 81): removeMovieClip / stop -> signal end
    // stopFrame is 81 (0-indexed) based on manifest stopFrame: 81
    this.mainAnim.stopAt(81);

    // Signal hit at start of impact (frame 0)
    this.mainAnim.onFrame(0, () => this.signalHit());

    this.mainAnim.addTo(this.container);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    if (this.mainAnim.isStopped() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
