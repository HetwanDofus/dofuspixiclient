/**
 * Spell 2056 - Unknown Spell
 *
 * A spell with a beam from caster and impact animation with physics particles at target.
 *
 * Components:
 * - sprite_3: Beam at caster position, rotated by angle
 * - sprite_8: Impact at target position with bouncing particles
 *
 * Original AS timing:
 * - Frame 1 (sprite_8): Signal hit (this.end())
 * - Frame 7 (sprite_8): Spawn physics particles
 * - Frame 22 (sprite_3): Stop beam
 * - Frame 109 (sprite_8): Start fade out
 * - Frame 142 (sprite_8): End animation
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const BEAM_MANIFEST: SpriteManifest = {
  width: 635.7,
  height: 0.6000000000000001,
  offsetX: 0,
  offsetY: -0.6000000000000001,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 398.40000000000003,
  height: 92.4,
  offsetX: -289.5,
  offsetY: -300.6,
};

interface PhysicsParticle {
  sprite: FrameAnimatedSprite;
  vx: number;
  vy: number;
  f: number;
  vrot: number;
  amp: number;
}

export class Spell2056 extends BaseSpell {
  readonly spellId = 2056;

  private beamAnim!: FrameAnimatedSprite;
  private impactAnim!: FrameAnimatedSprite;
  private particles: PhysicsParticle[] = [];
  private fadeStarted = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Beam animation at caster position (sprite_3)
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_3'),
      ...calculateAnchor(BEAM_MANIFEST),
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(0, init.casterY);
    this.beamAnim.sprite.rotation = init.angleRad;
    this.beamAnim.stopAt(21);
    this.container.addChild(this.beamAnim.sprite);

    // Impact animation at target position (sprite_8)
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_8'),
      ...calculateAnchor(IMPACT_MANIFEST),
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    this.impactAnim
      .onFrame(0, () => this.signalHit())
      .onFrame(6, () => this.spawnParticles(textures, init))
      .onFrame(108, () => { this.fadeStarted = true; })
      .stopAt(141);
    this.container.addChild(this.impactAnim.sprite);
  }

  private spawnParticles(textures: SpellTextureProvider, init: SpellInitContext): void {
    // From DefineSprite_8/frame_7/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(load).as
    const g = 0.83;
    const amp = 2.5;
    const vx = 2 * amp * (-0.5 + Math.random());
    const vy = amp * (-0.5 + Math.random());
    const f = -5 - Math.floor(Math.random() * 5);
    const vrot = -100 + Math.floor(Math.random() * 200);

    // Create particle sprite (uses same texture as impact)
    const particle = new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_8'),
      ...calculateAnchor(IMPACT_MANIFEST),
      scale: init.scale,
    });
    particle.sprite.position.set(init.targetX, init.targetY);

    this.particles.push({
      sprite: particle,
      vx,
      vy,
      f,
      vrot,
      amp,
    });

    this.container.addChild(particle.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update physics particles
    for (const particle of this.particles) {
      const p = particle.sprite.sprite;
      
      // From DefineSprite_8/frame_7/PlaceObject2_5_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
      p.rotation = particle.vrot;
      p.x += particle.vx;
      p.y += particle.vy;
      
      particle.f += 0.83; // g = 0.83
      p.y += particle.f;
      
      // Bounce logic
      if (p.y > 0) {
        particle.vrot *= 0.5;
        p.y = 0;
        particle.f = -particle.f / 2;
        particle.amp *= 0.6;
        particle.vx = particle.amp * (-0.5 + Math.random());
        particle.vy = particle.amp * (-0.5 + Math.random());
      }

      particle.sprite.update(deltaTime);
    }

    // Fade out starting at frame 109
    if (this.fadeStarted) {
      // From DefineSprite_8/frame_109/PlaceObject2_7_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
      this.impactAnim.sprite.alpha -= 10 / 255;
      for (const particle of this.particles) {
        particle.sprite.sprite.alpha -= 10 / 255;
      }
    }

    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    for (const particle of this.particles) {
      particle.sprite.destroy();
    }
    this.particles = [];
    super.destroy();
  }
}