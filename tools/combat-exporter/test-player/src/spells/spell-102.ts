/**
 * Spell 102 - Artillery Strike
 *
 * A bombardment spell with falling projectiles and debris particles.
 *
 * Components:
 * - anim1: Main animation sequence showing the artillery strike
 * - baton/baton2: Debris particles with physics-based movement
 *
 * Original AS timing:
 * - Frame 1: Play sound "arty_102"
 * - Frame 48: Animation stops (fadingFrame at 47)
 * - Frame 172: Complete spell and remove
 */

import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 831.3,
  height: 549.3,
  offsetX: -422.4,
  offsetY: -441,
};

interface Baton2RotationData {
  amplitude: number;
  phase: number;
  decay: number;
  frame: number;
}

export class Spell102 extends BaseSpell {
  readonly spellId = 102;

  private mainAnim!: FrameAnimatedSprite;
  private batonParticles!: ASParticleSystem;
  private baton2Particles!: ASParticleSystem;
  private baton2RotationData: Baton2RotationData[] = [];

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const mainAnchor = calculateAnchor(ANIM1_MANIFEST);

    // Main animation
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: mainAnchor.x,
      anchorY: mainAnchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);
    this.mainAnim
      .stopAt(47)  // AS frame 48, fading frame
      .onFrame(0, () => this.callbacks.playSound('arty_102'));
    
    // Signal hit when the impact occurs (estimating mid-animation)
    this.mainAnim.onFrame(24, () => this.signalHit());
    
    this.container.addChild(this.mainAnim.sprite);

    // Baton particle system (debris type 1)
    const batonTexture = textures.getFrames('lib_baton')[0] ?? Texture.EMPTY;
    this.batonParticles = new ASParticleSystem(batonTexture);
    this.batonParticles.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.batonParticles.container);

    // Baton2 particle system (debris type 2)
    const baton2Texture = textures.getFrames('lib_baton2')[0] ?? Texture.EMPTY;
    this.baton2Particles = new ASParticleSystem(baton2Texture);
    this.baton2Particles.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.baton2Particles.container);

    // Spawn debris particles based on the AS scripts
    this.spawnDebris();
  }

  private spawnDebris(): void {
    // Spawn baton particles
    // From DefineSprite_18_baton/frame_1/DoAction.as
    this.batonParticles.spawnMany(8, () => {
      const v = 5 * (-0.5 + Math.random());
      const vy = 3 * (-0.5 + Math.random());
      const t = 50 + 40 * (-0.5 + Math.random());

      return {
        x: 0,
        y: 0,
        vx: v,
        vy: vy,
        accX: 0.95,  // Friction
        accY: 0.95,
        t: t,        // Scale as percentage
        vt: -0.5,    // Shrink over time
      };
    });

    // Spawn baton2 particles
    // From DefineSprite_17_baton2/frame_1/DoAction.as
    this.baton2Particles.spawnMany(6, () => {
      const t = 100 - Math.floor(Math.random() * 50);
      const x = 40 * (0.5 - Math.random());
      const y = 20 * (0.5 - Math.random());

      // Store rotation params in baton2RotationData array
      const a = 10 + Math.floor(Math.random() * 20);
      const i = 6 * Math.random();
      const v2 = 1.05 + 0.5 * Math.random();
      this.baton2RotationData.push({ amplitude: a, phase: i, decay: v2, frame: 0 });

      return {
        x: x,
        y: y,
        t: t,        // Scale as percentage
        vt: -0.5,    // Shrink over time
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.batonParticles.update();
    this.baton2Particles.update();

    // Update baton2 particle rotations based on AS onClipEvent(enterFrame)
    // Access sprites through the container's children
    const baton2Children = this.baton2Particles.container.children;
    for (let i = 0; i < baton2Children.length && i < this.baton2RotationData.length; i++) {
      const sprite = baton2Children[i];
      const rotData = this.baton2RotationData[i];
      if (sprite.visible) {
        sprite.rotation = (rotData.amplitude * Math.sin(rotData.phase + rotData.frame * 0.1)) * Math.PI / 180;
        rotData.amplitude /= rotData.decay;
        rotData.frame++;
      }
    }

    // Check completion
    if (this.anims.allComplete() &&
        !this.batonParticles.hasAliveParticles() &&
        !this.baton2Particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.batonParticles.destroy();
    this.baton2Particles.destroy();
    super.destroy();
  }
}