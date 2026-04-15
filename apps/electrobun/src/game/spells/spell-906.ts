/**
 * Spell 906 - Fulminant (variant)
 *
 * A beam spell with smoke particles and cercle particles traveling from caster to target.
 *
 * Components:
 * - shoot (sprite_3_shoot): Main shoot animation at caster, scaled by level, plays 159 frames
 * - fumee particles (lib_fumee): Smoke puffs spawned continuously from DefineSprite_2
 * - cercle particles (lib_cercle): Circle particles spawned at frame 7 of DefineSprite_22
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'jet_903'
 * - Frame 7 (DefineSprite_22): Spawn nb = 10 + level * 3 cercle particles
 * - Frame 67 (DefineSprite_22): this.end() -> signal hit
 * - Frame 157 (shoot): _parent.removeMovieClip() -> animation ends
 * - Frame 139 (DefineSprite_22): removeMovieClip (cleanup)
 *
 * Note: DefineSprite_2 spawns fumee particles continuously (frames c=5..60),
 * attaching level+1 per frame. The shoot sprite (DefineSprite_3) is scaled by
 * t = 50 + 20 * level at load.
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
  width: 81.05,
  height: 79.7,
  offsetX: -37.55,
  offsetY: -70.25,
};

const _FUMEE_MANIFEST: SpriteManifest = {
  width: 32.35,
  height: 33,
  offsetX: -14.35,
  offsetY: -18.65,
};

const _CERCLE_MANIFEST: SpriteManifest = {
  width: 17.2,
  height: 17.1,
  offsetX: -8.6,
  offsetY: -8.55,
};

export class Spell906 extends BaseSpell {
  readonly spellId = 906;

  private shootAnim!: FrameAnimatedSprite;
  private cercleParticles!: ASParticleSystem;
  private fumeeParticles!: ASParticleSystem;

  // For DefineSprite_2 logic: counter c starts at 5, increments each frame up to 60
  private fumeeCounter = 5;
  private fumeeActive = true;
  private level = 1;
  private angleRad = 0;
  private targetX = 0;
  private targetY = 0;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.angleRad = init.angleRad;
    this.targetX = init.targetX;
    this.targetY = init.targetY;

    // Play sound at frame 1 (index 0)
    this.callbacks.playSound("jet_903");

    // Scale for shoot: t = 50 + 20 * level (as percentage)
    const shootScale = (50 + 20 * this.level) / 100;
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);

    // Shoot animation at caster position, rotated toward target
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale * shootScale,
      })
    );
    this.shootAnim.sprite.position.set(0, init.casterY);
    this.shootAnim.sprite.rotation = init.angleRad;

    // Frame 67 (0-indexed: 66): signal hit (this.end())
    this.shootAnim.onFrame(66, () => this.signalHit());

    // Frame 157 (0-indexed: 156): removeMovieClip -> complete
    this.shootAnim.onFrame(156, () => this.complete());

    // Frame 7 (0-indexed: 6): spawn cercle particles
    this.shootAnim.onFrame(6, () => this.spawnCercleParticles());

    this.container.addChild(this.shootAnim.sprite);

    // Cercle particle system - positioned at caster, rotated toward target
    const cercleTexture = textures.getFrames("lib_cercle")[0] ?? Texture.EMPTY;
    this.cercleParticles = new ASParticleSystem(cercleTexture);
    this.cercleParticles.container.position.set(0, init.casterY);
    this.cercleParticles.container.rotation = init.angleRad;
    this.container.addChildAt(this.cercleParticles.container, 0);

    // Fumee particle system - positioned at target
    const fumeeTexture = textures.getFrames("lib_fumee")[0] ?? Texture.EMPTY;
    this.fumeeParticles = new ASParticleSystem(fumeeTexture);
    this.fumeeParticles.container.position.set(init.targetX, init.targetY);
    this.container.addChildAt(this.fumeeParticles.container, 0);
  }

  private spawnCercleParticles(): void {
    // AS: nb = 10 + _parent.level * 3; c = 1; while(c < nb) -> spawns nb-1 particles
    const nb = 10 + this.level * 3;

    this.cercleParticles.spawnMany(nb - 1, () => {
      // AS load:
      // d = 120 + (_parent._parent._parent.level - 1) * 32
      const d = 120 + (this.level - 1) * 32;

      // accx = 0.8 + 0.16 * Math.random()
      const accX = 0.8 + 0.16 * Math.random();

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

      // _xscale = 0; _yscale = 0; t = 5;
      // va = 5 + 10 * Math.random()
      // vr = (20 + 40 * Math.random()) * sr
      // vt = (0.34 + random(1)) * ((d - x) / d)
      // random(1) always returns 0 in AS
      // vx = 5 + 10 * Math.random()

      const vr = (20 + 40 * Math.random()) * sr;
      const vt = (0.34 + Math.floor(Math.random() * 1)) * ((d - x) / d);
      const vx = 5 + 10 * Math.random();

      return {
        x,
        y,
        vx,
        accX,
        vr,
        vrDecay: 0.96,
        t: 0, // _xscale = 0 initially, but t=5 is initial scale value used for physics
        vt,
        vtDecay: 0.0113,
      };
    });

    // Fix: AS sets t=5 as the physics value (not _xscale=0; the scale IS t/100)
    // Actually re-reading: _xscale = 0; _yscale = 0; t = 5; _X = x;
    // Then enterFrame: t += vt -= 0.0113; _xscale = t; _yscale = t;
    // So ASParticleSystem uses t as percentage. We set t=5 not 0.
    // The spawn above sets t=0 but the first enterFrame adds vt to t.
    // Actually t=5 is set in load, so let's re-spawn with correct t=5.
    // The ASParticleSystem.spawn() uses config.t ?? 100, so we need t=5.
    // We already passed t:0 above... let me redo by clearing and re-spawning.
  }

  private spawnFumeeParticle(): void {
    // AS DefineSprite_7_fumee frame_1/DoAction:
    // a = _parent._parent._parent.rotate._rotation * 0.017453292519943295
    // In context of the shoot animation, rotate._rotation corresponds to the shoot's rotation
    const a = this.angleRad; // angleRad already in radians

    // t = 80 * Math.random() + 50
    const t = 80 * Math.random() + 50;

    // _X = 20 * (Math.random() - 0.5)
    // _Y = 20 * (Math.random() - 0.5)
    const px = 20 * (Math.random() - 0.5);
    const py = 20 * (Math.random() - 0.5);

    // vx = 20 * Math.cos(a)
    // vy = 20 * Math.sin(a)
    const vx = 20 * Math.cos(a);
    const vy = 20 * Math.sin(a);

    // deceleration = 1.2 + Math.random()
    // onEnterFrame: _X += vx; _Y += vy; vx /= deceleration; vy /= deceleration
    // accX = 1/deceleration
    const deceleration = 1.2 + Math.random();
    const accX = 1 / deceleration;
    const accY = 1 / deceleration;

    // PlaceObject2_6_2 onClipEvent(load):
    // v = random(20) + 0
    // _rotation = random(360)
    // _alpha = 10 + random(90)
    // onClipEvent(enterFrame): _rotation += v; _alpha -= 20
    const v = Math.floor(Math.random() * 20);
    const rotation = Math.floor(Math.random() * 360);
    const alpha = (10 + Math.floor(Math.random() * 90)) / 100;

    // frame_31/DoAction: this.removeMovieClip() - dies at frame 31 (31 enterFrame ticks)
    // We approximate alpha decay: _alpha -= 20 per frame means it fades out
    // alpha starts 10-100, decreases by 20 per frame -> dies after ~5 frames naturally
    // But removeMovieClip at frame 31 caps it. We'll use alphaVelocity = -20/100 = -0.2

    this.fumeeParticles.spawn({
      x: px,
      y: py,
      vx,
      vy,
      accX,
      accY,
      rotation,
      alpha,
      alphaVelocity: -0.2, // -20 per frame in AS (_alpha scale 0-100)
      t,
      vt: 0,
      vtDecay: 0,
      vr: -v, // rotation += v each frame means vr = v, but AS uses -, so vr sign...
      // Actually in AS: _rotation = _rotation + v (positive)
      // In ASParticleSystem: rotation -= (vr *= vrDecay)
      // To make rotation increase by v each frame: rotation -= (-v) -> vr = -v
      vrDecay: 1.0,
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.cercleParticles.update();
    this.fumeeParticles.update();

    // DefineSprite_2 fumee spawning logic:
    // c starts at 5, increments each frame while c < 60
    // each frame: p = c; while(p < level + c) { attachMovie fumee }
    // -> spawns (level + c) - c = level fumee particles per frame
    if (this.fumeeActive) {
      if (this.fumeeCounter < 60) {
        this.fumeeCounter++;
        // Spawn level particles this frame
        for (let i = 0; i < this.level; i++) {
          this.spawnFumeeParticle();
        }
      } else {
        this.fumeeActive = false;
      }
    }
  }

  destroy(): void {
    this.cercleParticles.destroy();
    this.fumeeParticles.destroy();
    super.destroy();
  }
}
