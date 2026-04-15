/**
 * Spell 909 - Fulminant
 *
 * A beam spell with particles that travels from caster to target.
 *
 * Components:
 * - Beam (sprite_22): At caster position, rotated toward target, stops at frame 42
 * - Particles (cercle): Spawned at frame 7 of beam animation (nb = 10 + level * 3)
 * - Impact (sprite_41): At target position, signals hit at frame 13, ends at frame 67
 *
 * Original AS timing:
 * - Frame 2 (main): Play sound 'jet_903'
 * - Frame 1 (sprite_22): Position at caster, rotate to angle
 * - Frame 7 (sprite_22): Spawn nb = 10 + level * 3 particles
 * - Frame 43 (sprite_22): stop()
 * - Frame 1 (sprite_41): Position at target, rotate to angle
 * - Frame 13 (sprite_41): this.end() - signal hit
 * - Frame 67 (sprite_41): removeMovieClip() - animation ends
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
  width: 262.55,
  height: 31.05,
  offsetX: -65.2,
  offsetY: -17.95,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 224.6,
  height: 88.25,
  offsetX: -59.85,
  offsetY: -47.3,
};

export class Spell909 extends BaseSpell {
  readonly spellId = 909;

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

    // Play sound at frame 2 (0-indexed: 1) of main timeline
    // AS: frame_2/DoAction.as -> SOMA.playSound("jet_903")
    // We trigger it immediately on setup (it's the first meaningful action)
    this.callbacks.playSound("jet_903");

    // Particle system - positioned at caster, rotated toward target
    const particleTexture =
      textures.getFrames("lib_cercle")[0] ?? Texture.EMPTY;
    this.particles = new ASParticleSystem(particleTexture);
    this.particles.container.position.set(0, init.casterY);
    this.particles.container.rotation = init.angleRad;
    this.container.addChildAt(this.particles.container, 0);

    // Beam animation (sprite_22) at caster position
    const beamAnchor = calculateAnchor(BEAM_MANIFEST);
    this.beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_22"),
        anchorX: beamAnchor.x,
        anchorY: beamAnchor.y,
        scale: init.scale,
      })
    );
    this.beamAnim.sprite.position.set(0, init.casterY);
    this.beamAnim.sprite.rotation = init.angleRad;
    this.beamAnim.stopAt(42).onFrame(6, () => this.spawnParticles());
    this.container.addChild(this.beamAnim.sprite);

    // Impact animation (sprite_41) at target position
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_41"),
        anchorX: impactAnchor.x,
        anchorY: impactAnchor.y,
        scale: init.scale,
      })
    );
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim.sprite.rotation = init.angleRad;
    this.impactAnim.stopAt(66).onFrame(12, () => this.signalHit());
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

      // AS: x = d * MAth.random()
      const x = d * Math.random();

      // AS: if(random(2) == 1) { _Y = 5; sr = -1; } else { sr = 1; _Y = -5; }
      let sr: number;
      let y: number;
      if (Math.floor(Math.random() * 2) === 1) {
        y = 5;
        sr = -1;
      } else {
        sr = 1;
        y = -5;
      }

      // AS: vr = (20 + 40 * MAth.random()) * sr
      const vr = (20 + 40 * Math.random()) * sr;

      // AS: vt = (1 + random(1)) * ((d - x) / d)
      // random(1) always returns 0 in AS (random(N) returns 0..N-1)
      const vt = (1 + Math.floor(Math.random() * 1)) * ((d - x) / d);

      // AS: vx = 5 + 10 * MAth.random()
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

    if (this.impactAnim.isStopped() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
