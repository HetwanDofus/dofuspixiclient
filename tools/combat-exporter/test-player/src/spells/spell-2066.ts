/**
 * Spell 2066 - Bubble Projectile
 *
 * Projectile spell with effects at both source and target positions,
 * creating bubble particles at impact.
 *
 * Components:
 * - sprite_4: Target cell effect bubble
 * - sprite_9: Source effect animation
 * - bulle: Bubble particles spawned at target
 *
 * Original AS timing:
 * - Frame 1: Source effect starts with "boo_up" sound
 * - Frame 2: Main timeline plays "jet_903" sound
 * - Frame 46: Source effect stops
 * - Frame 70: Target effect spawns 6 bubbles and calls end()
 * - Frame 133: Target effect removes itself
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

export class Spell2066 extends BaseSpell {
  readonly spellId = 2066;

  private sourceAnim!: FrameAnimatedSprite;
  private targetAnim!: FrameAnimatedSprite;
  private targetBubble!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const manifests = textures.getManifests();
    const sourceManifest = manifests['sprite_9'] as SpriteManifest;
    const targetBubbleManifest = manifests['sprite_4'] as SpriteManifest;
    const bubbleManifest = manifests['lib_bulle'] as SpriteManifest;

    // Get bubble particle texture
    const bubbleTexture = textures.getFrames('lib_bulle')[0];
    this.particles = new ASParticleSystem(bubbleTexture);
    this.container.addChild(this.particles.container);

    // Source animation (DefineSprite_10 behavior)
    this.sourceAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      manifest: sourceManifest,
      anchor: calculateAnchor(sourceManifest),
      scale: init.scale,
      x: 0,
      y: -25 * init.scale, // AS: y = cellFrom.y - 25
      stopAt: 45, // AS frame 46, TS frame 45
      stopBehavior: 'stop',
    }));

    this.sourceAnim
      .onFrame(0, () => {
        // Frame 1: plays "boo_up" sound
        this.callbacks.playSound('boo_up');
      });

    // Rotation element on source (frame 46 child clip)
    this.sourceAnim.rotation = init.angleRad;

    // Target bubble effect (sprite_4)
    this.targetBubble = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_4'),
      manifest: targetBubbleManifest,
      anchor: calculateAnchor(targetBubbleManifest),
      scale: init.scale,
      x: init.targetX,
      y: init.targetY - 30 * init.scale, // AS: y = cellTo.y - 30
      stopAt: 51, // AS frame 52, TS frame 51
      stopBehavior: 'stop',
    }));

    // Target effect starts later (DefineSprite_11 behavior)
    this.targetAnim = this.anims.add(new FrameAnimatedSprite({
      textures: [],  // Invisible container for timing
      manifest: { frameCount: 133, width: 0, height: 0, offsetX: 0, offsetY: 0 },
      anchor: { x: 0.5, y: 0.5 },
      scale: 1,
      x: init.targetX,
      y: init.targetY - 30 * init.scale,
      stopAt: 132, // AS frame 133, TS frame 132
      stopBehavior: 'stop',
    }));

    this.targetAnim.rotation = init.angleRad;

    this.targetAnim
      .onFrame(69, () => {
        // Frame 70: create 6 bubble particles
        for (let i = 0; i < 6; i++) {
          // AS bubble physics from DefineSprite_5_bulle
          const rx = 0.7 + Math.random() * 0.15; // AS: 0.7 + random(15) / 100
          const ry = 0.8 + Math.random() * 0.15; // AS: 0.8 + random(15) / 100
          const vx = 20 + Math.random() * 25; // AS: 20 + random(25)
          const vy = -15 + Math.random() * 30; // AS: -15 + random(30)
          const alpha = 0.5 + Math.random() * 0.5; // AS: 50 + random(50)
          const startFrame = Math.floor(Math.random() * 10); // AS: random(10) + 1

          // Random direction for horizontal velocity
          const direction = Math.random() < 0.5 ? -1 : 1;

          this.particles.spawn({
            x: init.targetX,
            y: init.targetY - 30 * init.scale,
            vx: vx * direction * init.scale,
            vy: vy * init.scale,
            scale: init.scale,
            alpha: alpha,
            friction: { x: rx, y: ry },
            startFrame: startFrame,
          });
        }
        
        // AS: this.end()
        this.signalHit();
      });

    // Main timeline sound at frame 2
    // Play this after a tiny delay to match AS frame timing
    setTimeout(() => {
      this.callbacks.playSound('jet_903');
    }, 1000 / 60); // 1 frame at 60fps
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all animations
    this.anims.update(deltaTime);

    // Update particles
    this.particles.update(deltaTime);

    // Check completion: all animations complete and no alive particles
    if (this.anims.allComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}