/**
 * Spell 1013 - Licrounch
 *
 * A crushing spell with multiple randomized particle effects at target location.
 *
 * Components:
 * - Main animation (DefineSprite_25): Contains 5 particle instances
 *   - 3 particles (sprite_16): Random start frame 1-7, positioned randomly
 *   - 1 particle (sprite_16): Random start frame 1-14, positioned randomly
 *   - 1 particle (sprite_16): Random start frame 1-21, positioned randomly
 * - Each particle (DefineSprite_24/sprite_16):
 *   - Random position X: -50 to +50
 *   - Random position Y: -150 to -50
 *   - Random rotation at frame 22
 *
 * Original AS timing:
 * - Frame 1: Position at target cell
 * - Frame 4: Play sound "licrounch_1013"
 * - Frame 82: Signal hit (this.end())
 * - Frame 121: Complete animation
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const PARTICLE_MANIFEST: SpriteManifest = {
  width: 119.4,
  height: 207.3,
  offsetX: -57.6,
  offsetY: -150.3,
};

class ParticleSprite extends FrameAnimatedSprite {
  private rotationSpeed = 0;
  private rotationFrame = -1;

  setRotationAtFrame(frame: number): void {
    this.rotationFrame = frame;
  }

  update(deltaTime: number): boolean {
    const result = super.update(deltaTime);

    // Apply rotation at frame 22 (21 in 0-indexed)
    if (this.rotationFrame >= 0 && this.getFrame() === this.rotationFrame && this.rotationSpeed === 0) {
      // AS: _rotation = random(360)
      this.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      this.rotationSpeed = 1; // Mark as rotated
    }

    return result;
  }
}

export class Spell1013 extends BaseSpell {
  readonly spellId = 1013;

  private mainContainer!: Container;
  private particles: ParticleSprite[] = [];

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const particleTextures = textures.getFrames('sprite_16');
    const particleAnchor = calculateAnchor(PARTICLE_MANIFEST);

    // Main container positioned at target
    this.mainContainer = new Container();
    this.mainContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.mainContainer);

    // Create 5 particle instances as per AS
    // 3 particles with random(7) + 1 -> 0-indexed: 0-6
    for (let i = 0; i < 3; i++) {
      const startFrame = Math.floor(Math.random() * 7);
      this.createParticle(particleTextures, particleAnchor, startFrame, init.scale);
    }

    // 1 particle with random(14) + 1 -> 0-indexed: 0-13
    const startFrame14 = Math.floor(Math.random() * 14);
    this.createParticle(particleTextures, particleAnchor, startFrame14, init.scale);

    // 1 particle with random(21) + 1 -> 0-indexed: 0-20
    const startFrame21 = Math.floor(Math.random() * 21);
    this.createParticle(particleTextures, particleAnchor, startFrame21, init.scale);

    // Sound at frame 4 (3 in 0-indexed)
    // Hit at frame 82 (81 in 0-indexed)
    // Use the first particle for timing events
    if (this.particles.length > 0) {
      this.particles[0]
        .onFrame(3, () => this.callbacks.playSound('licrounch_1013'))
        .onFrame(81, () => this.signalHit());
    }
  }

  private createParticle(
    textures: any[],
    anchor: { x: number; y: number },
    startFrame: number,
    scale: number
  ): void {
    const particle = new ParticleSprite({
      textures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale,
      startFrame,
    });

    // AS DefineSprite_24 frame 1:
    // _X = 100 * (Math.random() - 0.5) -> -50 to +50
    // _Y = -100 + 100 * (Math.random() - 0.5) -> -150 to -50
    particle.sprite.position.set(
      100 * (Math.random() - 0.5),
      -100 + 100 * (Math.random() - 0.5)
    );

    // Stop at frame 22 (21 in 0-indexed) as per manifest stopFrame
    particle.stopAt(21);
    
    // Set rotation at frame 22 (21 in 0-indexed)
    particle.setRotationAtFrame(21);

    this.mainContainer.addChild(particle.sprite);
    this.particles.push(particle);
    this.anims.add(particle);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Complete at frame 121 (120 in 0-indexed)
    // Since particles stop at frame 22, check if first particle reached its max frame
    if (this.particles.length > 0 && this.particles[0].getFrame() >= 120) {
      this.complete();
    }
  }
}