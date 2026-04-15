/**
 * Spell 2046 - Fulminant (variant)
 *
 * A beam spell with smoke and particle effects.
 *
 * Components:
 * - shoot (sprite): Main shoot animation at caster position, 159 frames
 * - DefineSprite_36: Container for particles and hit logic
 *   - Frame 1: Play sound 'vol'
 *   - Frame 7: Spawn 4 cercle particles (nb=5, c starts at 1, spawns nb-1=4)
 *   - Frame 67: Signal hit (this.end())
 *   - Frame 139: removeMovieClip (animation ends)
 * - fumee particles: Smoke puffs with velocity/deceleration physics
 * - cercle particles: Standard beam particles (same as spell 909)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'jet_903'
 * - Frame 1 (DefineSprite_36): Play sound 'vol'
 * - Frame 7 (DefineSprite_36): Spawn 4 cercle particles
 * - Frame 67 (DefineSprite_36): this.end() -> signalHit
 * - Frame 157 (shoot): removeMovieClip
 * - Frame 139 (DefineSprite_36): removeMovieClip
 *
 * The shoot animation plays at caster, rotated toward target.
 * DefineSprite_36 appears to be a separate effect sprite at the target/beam area.
 * Looking at the structure: DefineSprite_36 contains fumee (smoke) clips and cercle particles.
 * The shoot animation (DefineSprite_17_shoot) stops being used after frame 157 (0-indexed: 156).
 *
 * Structure analysis:
 * - Main timeline frame 1: plays 'jet_903', has DefineSprite_36 child
 * - DefineSprite_36: has fumee sprites and handles cercle particles
 * - DefineSprite_33: has 'a=20' load, contains fumee smoke sprites
 * - DefineSprite_32: has random xscale on load, stops at frame 34
 * - DefineSprite_21_fumee: smoke puff with velocity physics, dies at frame 31
 * - DefineSprite_24_cercle: beam particle with AS physics
 *
 * The shoot animation (159 frames) is the main beam visual at caster, rotated.
 * The fumee smoke sprites are spawned by DefineSprite_36.
 * The cercle particles use the same physics as spell 909.
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
  width: 174.3,
  height: 155.4,
  offsetX: -89.35,
  offsetY: -92.8,
};

const _FUMEE_MANIFEST: SpriteManifest = {
  width: 32.35,
  height: 33,
  offsetX: -14.35,
  offsetY: -18.65,
};

const _CERCLE_MANIFEST: SpriteManifest = {
  width: 17.4,
  height: 17.45,
  offsetX: -8.8,
  offsetY: -8.9,
};

export class Spell2046 extends BaseSpell {
  readonly spellId = 2046;

  private shootAnim!: FrameAnimatedSprite;
  private cercleParticles!: ASParticleSystem;
  private fumeeParticles!: ASParticleSystem;
  private level = 1;
  private angleRad = 0;
  private fumeeAngleRad = 0;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.angleRad = init.angleRad;
    // fumee uses _parent._parent._parent.rotate._rotation * 0.017453 which is the angle in radians
    this.fumeeAngleRad = init.angleRad;

    // Main shoot animation at caster position, rotated toward target
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        ...calculateAnchor(SHOOT_MANIFEST),
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;
    // Frame 1 (0-indexed: 0): play 'jet_903'
    this.shootAnim.onFrame(0, () => this.callbacks.playSound("jet_903"));
    // Frame 157 (0-indexed: 156): shoot removeMovieClip - animation effectively ends
    this.container.addChild(this.shootAnim.sprite);

    // Cercle particle system (beam particles) - positioned at caster, rotated toward target
    // Same as spell 909: positioned along the beam direction
    const cercleTexture = textures.getFrames("lib_cercle")[0] ?? Texture.EMPTY;
    this.cercleParticles = new ASParticleSystem(cercleTexture);
    this.cercleParticles.container.position.set(0, init.casterY);
    this.cercleParticles.container.rotation = init.angleRad;
    this.container.addChildAt(this.cercleParticles.container, 0);

    // Fumee (smoke) particle system - at caster position
    // fumee sprites use the fumee animation frames and physics
    const fumeeTexture = textures.getFrames("fumee")[0] ?? Texture.EMPTY;
    this.fumeeParticles = new ASParticleSystem(fumeeTexture);
    this.fumeeParticles.container.position.set(0, init.casterY);
    this.container.addChildAt(this.fumeeParticles.container, 0);

    // DefineSprite_36 behavior is embedded in the shoot animation timing:
    // Frame 1 (0-indexed: 0): play 'vol'
    // Frame 7 (0-indexed: 6): spawn cercle particles (nb=5, loop c=1..nb-1 = 4 particles)
    // Frame 67 (0-indexed: 66): signal hit
    // Frame 139 (0-indexed: 138): complete
    // We attach these callbacks to the shootAnim since it drives the main timeline

    this.shootAnim.onFrame(0, () => this.callbacks.playSound("vol"));
    this.shootAnim.onFrame(6, () => this.spawnCercleParticles());
    this.shootAnim.onFrame(6, () => this.spawnFumeeParticles());
    this.shootAnim.onFrame(66, () => this.signalHit());
    this.shootAnim.onFrame(138, () => this.complete());
  }

  private spawnCercleParticles(): void {
    // AS: nb = 5; c = 0; c = 1; while(c < nb) -> spawns 4 particles (c=1,2,3,4)
    const nb = 5;

    this.cercleParticles.spawnMany(nb - 1, () => {
      // AS onClipEvent(load) for cercle:
      // d = 120 + (_parent._parent._parent.level - 1) * 32
      const d = 120 + (this.level - 1) * 32;

      // accx = 0.8 + 0.12 * Math.random()
      const accX = 0.8 + 0.12 * Math.random();

      // x = d * Math.random()
      const x = d * Math.random();

      // if(random(2) == 1) { _Y = 5; sr = -1; } else { sr = 1; _Y = -5; }
      let sr: number;
      let y: number;
      if (Math.floor(Math.random() * 2) === 1) {
        y = 5;
        sr = -1;
      } else {
        sr = 1;
        y = -5;
      }

      // _xscale = 0; _yscale = 0; t = 5; _X = x;
      // va = 5 + 10 * Math.random()  (not used in enterFrame, likely unused)
      // vr = (20 + 40 * Math.random()) * sr
      const vr = (20 + 40 * Math.random()) * sr;

      // vt = (0.3 + random(1)) * ((d - x) / d)
      // random(1) always returns 0 in AS
      const vt = (0.3 + Math.floor(Math.random() * 1)) * ((d - x) / d);

      // vx = 5 + 10 * Math.random()
      const vx = 5 + 10 * Math.random();

      // enterFrame:
      // _rotation -= (vr *= 0.97)
      // _X += (vx *= accx)
      // t += vt -= 0.03   -> vtDecay = 0.03
      // _xscale = t; _yscale = t
      // if (t < 0) removeMovieClip

      return {
        x,
        y,
        vx,
        accX,
        vr,
        vrDecay: 0.97,
        t: 5,
        vt,
        vtDecay: 0.03,
      };
    });
  }

  private spawnFumeeParticles(): void {
    // DefineSprite_21_fumee frame_1/DoAction:
    // a = _parent._parent._parent.rotate._rotation * 0.017453292519943295 (angle in radians)
    // t = 80 * Math.random() + 50
    // _xscale = t; _yscale = t
    // _X = 20 * (Math.random() - 0.5)
    // _Y = 20 * (Math.random() - 0.5)
    // vx = 20 * Math.cos(a)
    // vy = 20 * Math.sin(a)
    // deceleration = 1.2 + Math.random()
    // onEnterFrame: _X += vx; _Y += vy; vx /= deceleration; vy /= deceleration

    // The fumee child sprite (DefineSprite_20 inside fumee):
    // v = random(20) + 0  (rotation speed)
    // _rotation = random(360)
    // _alpha = 10 + random(90)
    // enterFrame: _rotation += v; _alpha -= 20
    // fumee dies at frame 31 (0-indexed: 30)

    // DefineSprite_33 wraps fumee and has 'a = 20' on load
    // DefineSprite_32 inside has random xscale and stops at frame 34

    // We simulate the fumee physics using ASParticleSystem
    // The fumee moves along the beam direction with deceleration

    const a = this.fumeeAngleRad;

    // Spawn multiple fumee puffs - looking at the AS structure,
    // DefineSprite_36 contains fumee clips. The exact count isn't in the scripts shown
    // but based on DefineSprite_33 (which wraps fumee) having 'a=20',
    // and DefineSprite_32 having random xscale, these appear to be individual smoke puffs.
    // We'll spawn a reasonable number matching typical Dofus smoke patterns.
    // Given the structure, it appears about 5 fumee instances are created (similar to cercle).

    const fumeeCount = 5;

    this.fumeeParticles.spawnMany(fumeeCount, () => {
      // t = 80 * Math.random() + 50  (scale as percentage)
      const t = 80 * Math.random() + 50;

      // _X = 20 * (Math.random() - 0.5)
      const x = 20 * (Math.random() - 0.5);

      // _Y = 20 * (Math.random() - 0.5)
      const y = 20 * (Math.random() - 0.5);

      // vx = 20 * Math.cos(a)
      const vx = 20 * Math.cos(a);

      // vy = 20 * Math.sin(a)
      const vy = 20 * Math.sin(a);

      // deceleration = 1.2 + Math.random()
      // In AS: vx /= deceleration each frame
      // ASParticleSystem uses accX as multiplier: vx *= accX
      // So accX = 1 / deceleration ... but deceleration varies per particle
      // We compute it here and store as accX = 1 / deceleration
      const deceleration = 1.2 + Math.random();
      const accX = 1 / deceleration;
      const accY = 1 / deceleration;

      // _rotation = random(360) (child sprite rotation, approximate with particle rotation)
      const rotation = Math.floor(Math.random() * 360);

      // _alpha = 10 + random(90)  -> (10 to 99)
      const alpha = (10 + Math.floor(Math.random() * 90)) / 100;

      // v = random(20) + 0 (rotation velocity of child)
      const vr = Math.floor(Math.random() * 20);

      // The fumee dies at frame 31 (frame_31/DoAction: removeMovieClip)
      // At 60fps, 30 frames = 500ms. The smoke fades via _alpha -= 20 per frame on the inner sprite.
      // We use alphaVelocity to fade: starting alpha ~55%, fading by ~20/100 per frame = 0.2/frame
      // But the alpha decrease is on the inner child sprite, not the fumee container itself.
      // We approximate by fading the particle over ~5 frames (alpha starts ~55% average)
      // alphaVelocity = -alpha / 5 frames approximate
      // Actually the inner sprite fades: starting alpha = 10+random(90) average ~55%
      // decreasing by 20 per frame in percentage terms = -0.20 per frame
      // After 3 frames: 55% - 60% = gone. Let's use alphaVelocity = -0.15

      return {
        x,
        y,
        vx,
        vy,
        accX,
        accY,
        vr,
        vrDecay: 1, // rotation doesn't decay in AS (v is constant)
        t,
        vt: 0,
        vtDecay: 0,
        rotation,
        alpha,
        alphaVelocity: -0.15,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.cercleParticles.update();
    this.fumeeParticles.update();

    // Completion is triggered via onFrame(138) callback -> this.complete()
    // But also check if shoot is complete as fallback
    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    this.cercleParticles.destroy();
    this.fumeeParticles.destroy();
    super.destroy();
  }
}
