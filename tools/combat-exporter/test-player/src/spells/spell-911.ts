/**
 * Spell 911 - Fulminant (variant)
 *
 * A beam spell with particles traveling from caster to target.
 *
 * Components:
 * - sprite_20: Beam at caster position, rotated toward target, stops at frame 42
 *   - Spawns nb = 10 + level * 3 cercle particles at frame 6
 * - sprite_25: Cercle particles (attached to sprite_20), random rotation/scale
 * - sprite_29: Impact at target position, signals hit at frame 33, ends at frame 81
 *
 * Original AS timing:
 * - Frame 2 (main): Play sound 'jet_903', stop main timeline
 * - Frame 1 (sprite_20): Position at caster, rotate toward target
 * - Frame 7 (sprite_20): Spawn nb = 10 + level * 3 cercle particles
 * - Frame 43 (sprite_20): stop()
 * - Frame 1 (sprite_29): Position at target, rotate toward target
 * - Frame 34 (sprite_29): this.end() - signal hit
 * - Frame 82 (sprite_29): removeMovieClip() - animation ends
 * - Frame 1 (sprite_25): Random rotation (0-359), random scale (50-99%)
 * - Frame 40 (sprite_25): stop()
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const BEAM_MANIFEST: SpriteManifest = {
  width: 152.95,
  height: 41.2,
  offsetX: 5.1,
  offsetY: -25.1,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 147.8,
  height: 93.75,
  offsetX: -72.85,
  offsetY: -48.4,
};

export class Spell911 extends BaseSpell {
  readonly spellId = 911;

  private beamAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;
  private level = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // Beam animation (sprite_20) at caster position
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_20'),
      ...calculateAnchor(BEAM_MANIFEST),
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(0, init.casterY);
    this.beamAnim.sprite.rotation = init.angleRad;
    this.beamAnim
      .stopAt(42)
      .onFrame(0, () => this.callbacks.playSound('jet_903'))
      .onFrame(6, () => this.spawnParticles());
    this.container.addChild(this.beamAnim.sprite);

    // Particle system - positioned at caster, rotated toward target
    const particleTexture = textures.getFrames('sprite_25')[0] ?? Texture.EMPTY;
    this.particles = new ASParticleSystem(particleTexture);
    this.particles.container.position.set(0, init.casterY);
    this.particles.container.rotation = init.angleRad;
    this.container.addChildAt(this.particles.container, 0);

    // Impact animation (sprite_29) at target position
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_29'),
      ...calculateAnchor(IMPACT_MANIFEST),
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim.sprite.rotation = init.angleRad;
    this.impactAnim.onFrame(33, () => this.signalHit());
    this.container.addChild(this.impactAnim.sprite);
  }

  private spawnParticles(): void {
    // AS: nb = 10 + _parent.level * 3; c = 1; while(c < nb) -> spawns nb-1 particles
    const nb = 10 + this.level * 3;

    this.particles.spawnMany(nb - 1, () => {
      // AS: _rotation = random(360)
      const rotation = Math.floor(Math.random() * 360);

      // AS: t = random(50) + 50  -> scale 50-99%
      const t = Math.floor(Math.random() * 50) + 50;

      return {
        x: 0,
        y: 0,
        rotation,
        t,
        vt: 0,
        vtDecay: 0,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    // spell ends when impact animation completes (frame 81 = index 81, frameCount 84)
    if (this.impactAnim.isComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
