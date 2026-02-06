/**
 * Spell 201 - Griffes (Claws)
 *
 * Multi-strike claw attack effect with randomized positioning and rotation.
 *
 * Components:
 * - griffes: Claw strike animation at target position
 *
 * Original AS timing:
 * - Frame 0: Play "crockette_201" sound
 * - Frame 6: Play "lance02" sound
 * - Frame 13: Signal hit (this.end())
 * - Creates up to 7 claw instances with random positioning
 */

import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

const GRIFFES_MANIFEST: SpriteManifest = {
  width: 367.5,
  height: 230.7,
  offsetX: -145.8,
  offsetY: -129.6,
};

export class Spell201 extends BaseSpell {
  readonly spellId = 201;

  private cpt = 0;
  private clawAnimations: FrameAnimatedSprite[] = [];

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const griffesTextures = textures.getFrames('griffes');
    const anchor = calculateAnchor(GRIFFES_MANIFEST);

    // Play initial sound
    this.callbacks.playSound('crockette_201');

    // Create first two claw sprites with different rotations
    // First sprite: rotation = random(90) + 135 (AS 1-indexed)
    const rotation1 = (Math.floor(Math.random() * 90) + 135) * Math.PI / 180;
    const claw1 = this.createClaw(griffesTextures, anchor, init, rotation1, 0, 1100);
    
    // Second sprite: rotation = random(90) - 45
    const rotation2 = (Math.floor(Math.random() * 90) - 45) * Math.PI / 180;
    const claw2 = this.createClaw(griffesTextures, anchor, init, rotation2, 0, 1000);

    // Set up timer to create more claws
    const timer = this.anims.add(new FrameAnimatedSprite({
      textures: [griffesTextures[0]], // Dummy texture for timing
      visible: false,
    }));
    
    timer
      .onFrame(6, () => {
        this.callbacks.playSound('lance02');
        
        // Start creating additional claws
        this.createAdditionalClaws(griffesTextures, anchor, init);
      })
      .onFrame(12, () => this.signalHit())
      .stopAt(162); // Stop at frame 163 (0-indexed)

    this.container.addChild(timer.sprite);
  }

  private createClaw(
    textures: any[],
    anchor: { x: number; y: number },
    init: SpellInitContext,
    rotation: number,
    yOffset: number,
    depth: number
  ): FrameAnimatedSprite {
    const claw = new FrameAnimatedSprite({
      textures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    });
    
    claw.sprite.position.set(init.targetX, init.targetY + yOffset);
    claw.sprite.rotation = rotation;
    claw.sprite.zIndex = depth;
    
    // Claws remove themselves after frame 28
    claw.stopAt(27);
    
    this.container.addChild(claw.sprite);
    this.clawAnimations.push(claw);
    this.cpt++;
    
    return claw;
  }

  private createAdditionalClaws(
    textures: any[],
    anchor: { x: number; y: number },
    init: SpellInitContext
  ): void {
    // Continue creating claws until we reach 7
    if (this.cpt >= 7) {
      return;
    }

    // Create timer for spawning additional claws
    const spawnTimer = this.anims.add(new FrameAnimatedSprite({
      textures: [textures[0]], // Dummy texture
      visible: false,
    }));

    let frameCounter = 0;
    spawnTimer.onEveryFrame(() => {
      // Spawn a new claw every ~13 frames (matching AS behavior)
      if (frameCounter % 13 === 0 && this.cpt < 7) {
        // Random Y offset: _Y = random(40) - 40 (range: -40 to 0)
        const yOffset = Math.floor(Math.random() * 40) - 40;
        
        // Alternate between the two rotation ranges
        const rotation = this.cpt % 2 === 0
          ? (Math.floor(Math.random() * 90) + 135) * Math.PI / 180
          : (Math.floor(Math.random() * 90) - 45) * Math.PI / 180;
        
        this.createClaw(textures, anchor, init, rotation, yOffset, this.cpt + 100);
      }
      frameCounter++;
    });

    spawnTimer.stopAt(90); // Stop spawning after sufficient time
    this.container.addChild(spawnTimer.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update manual claw animations
    for (const claw of this.clawAnimations) {
      claw.update(deltaTime);
    }

    // Check if all animations are complete
    if (this.anims.allComplete() && this.clawAnimations.every(claw => claw.isComplete())) {
      this.complete();
    }
  }

  destroy(): void {
    for (const claw of this.clawAnimations) {
      claw.destroy();
    }
    this.clawAnimations = [];
    super.destroy();
  }
}