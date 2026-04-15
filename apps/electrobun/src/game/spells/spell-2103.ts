/**
 * Spell 2103 - Fulminant (variant)
 *
 * A beam spell with particles that travels from caster to target.
 *
 * Components:
 * - Beam (sprite_19): At caster position, rotated toward target, stops at frame 69
 * - Particles (cercle): Spawned at frame 6 of beam animation (AS frame 7)
 * - Impact (sprite_33): At target position, signals hit at frame 12 (AS frame 13)
 *
 * Original AS timing:
 * - Frame 2 (main): Play sound 'jet_903'
 * - Frame 7 (sprite_19): Spawn nb = 10 + level * 3 particles
 * - Frame 13 (sprite_33): Signal hit (this.end())
 * - Frame 70 (sprite_19): stop()
 * - Frame 67 (sprite_33): removeMovieClip() - animation ends
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

const BEAM_MANIFEST: SpriteManifest = {
  width: 171.35,
  height: 28,
  offsetX: -36.35,
  offsetY: -14.9,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 224.15,
  height: 88.25,
  offsetX: -59.4,
  offsetY: -47.3,
};

export class Spell2103 extends BaseSpell {
  readonly spellId = 2103;

  private beamAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;
  private level = 1;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Beam animation (sprite_19) at caster position
    // AS frame 1: _X = cellFrom.x, _Y = cellFrom.y - 50, _rotation = angle
    // AS frame 7: spawn particles (0-indexed: 6)
    // AS frame 70: stop() (0-indexed: 69)
    this.beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_19"),
        ...calculateAnchor(BEAM_MANIFEST),
        scale: init.scale,
      })
    );
    this.beamAnim.sprite.position.set(0, init.casterY);
    this.beamAnim.sprite.rotation = init.angleRad;
    this.beamAnim
      .stopAt(69)
      .onFrame(0, () => this.callbacks.playSound("jet_903"))
      .onFrame(6, () => this.spawnParticles());
    this.container.addChild(this.beamAnim.sprite);

    // Particle system - positioned at caster, rotated toward target
    const particleTexture =
      textures.getFrames("lib_cercle")[0] ?? Texture.EMPTY;
    this.particles = new ASParticleSystem(particleTexture);
    this.particles.container.position.set(0, init.casterY);
    this.particles.container.rotation = init.angleRad;
    this.container.addChildAt(this.particles.container, 0);

    // Impact animation (sprite_33) at target position
    // AS frame 1: _X = cellTo.x, _Y = cellTo.y - 50, _rotation = angle
    // AS frame 13: this.end() -> signalHit (0-indexed: 12)
    // AS frame 67: removeMovieClip() (0-indexed: 66)
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_33"),
        ...calculateAnchor(IMPACT_MANIFEST),
        scale: init.scale,
      })
    );
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim.sprite.rotation = init.angleRad;
    this.impactAnim.onFrame(12, () => this.signalHit());
    this.container.addChild(this.impactAnim.sprite);
  }

  private spawnParticles(): void {
    // AS: nb = 10 + _parent.level * 3; c = 1; while(c < nb) -> spawns nb-1 particles
    const nb = 10 + this.level * 3;

    this.particles.spawnMany(nb - 1, () => {
      // AS: d = 120 + (_parent._parent._parent.level - 1) * 32
      const d = 120 + (this.level - 1) * 32;

      // AS: accx = 0.8 + 0.12 * Math.random()
      const accX = 0.8 + 0.12 * Math.random();

      // AS: x = d * Math.random()
      const x = d * Math.random();

      // AS: if(random(4) == 1) { _Y = 5; sr = -1; } else { sr = 1; _Y = -5; }
      let sr: number;
      let y: number;
      if (Math.floor(Math.random() * 4) === 1) {
        y = 5;
        sr = -1;
      } else {
        sr = 1;
        y = -5;
      }

      // AS: vr = (20 + 40 * Math.random()) * sr
      const vr = (20 + 40 * Math.random()) * sr;

      // AS: vt = (1 + random(1)) * ((d - x) / d)
      // random(1) always returns 0 in AS (random(N) returns 0..N-1)
      const vt = (1 + Math.floor(Math.random() * 1)) * ((d - x) / d);

      // AS: vx = 5 + 10 * Math.random()
      const vx = 5 + 10 * Math.random();

      return {
        x,
        y,
        vx,
        accX,
        vr,
        vrDecay: 0.97,
        t: 5,
        vt,
        vtDecay: 0.1,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    if (this.impactAnim.isComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
