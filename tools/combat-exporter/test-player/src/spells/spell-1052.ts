import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

/**
 * Spell 1052 - Aspiration
 *
 * A beam spell with a secondary effect that creates an aspiration/suction animation.
 *
 * Components:
 * - sprite_20: Main aspiration beam positioned at caster
 * - sprite_18: Secondary effect with random vertical offset
 *
 * Original AS timing:
 * - Frame 2: Play "aspiration" sound
 * - Frame 6: Position sprite_20 at caster with rotation
 * - Frame 78: Signal hit
 * - Frame 145: Complete sprite_20
 * - sprite_18 Frame 1: Random Y offset and 50% vertical flip
 */
export class Spell1052 extends BaseSpell {
  readonly spellId = 1052;

  private beamAnim!: FrameAnimatedSprite;
  private effectAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Get sprite manifests
    const beamManifest: SpriteManifest = { width: 2939.1, height: 196.5, offsetX: 126.45, offsetY: 98.25 };
    const effectManifest: SpriteManifest = { width: 1321.5, height: 207.3, offsetX: 57.3, offsetY: 103.65 };

    // Create main beam animation (sprite_20)
    const beamFrames = textures.getFrames('sprite_20');
    const beamAnchor = calculateAnchor(beamManifest);
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: beamFrames,
      startFrame: 5,  // AS frame 6 (0-indexed)
      stopFrame: 144,    // AS frame 145 (0-indexed)
      anchorX: beamAnchor.x,
      anchorY: beamAnchor.y,
      scale: init.scale,
    }));

    // Position beam at caster with offset (AS frame 6 logic)
    this.beamAnim.sprite.position.set(0, -20 * init.scale);
    this.beamAnim.sprite.rotation = init.angleRad;

    // Create secondary effect animation (sprite_18)
    const effectFrames = textures.getFrames('sprite_18');

    // AS frame 1 logic: random Y offset and 50% vertical flip
    const randomY = 20 * (-0.5 + Math.random());
    const flipVertical = Math.floor(Math.random() * 2) === 1;

    const effectAnchor = calculateAnchor(effectManifest);
    this.effectAnim = this.anims.add(new FrameAnimatedSprite({
      textures: effectFrames,
      startFrame: 0,
      stopFrame: 47,     // AS frame 48 (0-indexed)
      anchorX: effectAnchor.x,
      anchorY: effectAnchor.y,
      scale: init.scale,
    }));

    // Position effect sprite
    this.effectAnim.sprite.position.set(init.targetX, init.targetY + randomY * init.scale);
    // Apply vertical flip via scale
    if (flipVertical) {
      this.effectAnim.sprite.scale.y = -init.scale;
    }

    // Frame callbacks
    // Play sound at frame 2 (AS frame 2 on main timeline)
    this.beamAnim.onFrame(1, () => this.callbacks.playSound('aspiration'));

    // Hit signal at frame 78 (AS frame 78 in sprite_20)
    this.beamAnim.onFrame(77, () => this.signalHit());

    // Add sprites to container
    this.container.addChild(this.beamAnim.sprite);
    this.container.addChild(this.effectAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all registered animations
    this.anims.update(deltaTime);

    // Check completion - both animations must be complete
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}