import { Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '../../../spell-interface';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '../../../spell-utils';
import { BaseSpell, type SpellInitContext } from './base-spell';

/**
 * Spell 109 - Shield/Protection Spell
 *
 * A shield animation with rotating elements that plays for approximately 2.15 seconds.
 *
 * Components:
 * - anim1: Main shield animation (129 frames)
 * - Internal sprites with rotation effects
 *
 * Original AS timing:
 * - Frame 1: Play shield_cara sound, initialize random rotation
 * - Frame 28: DefineSprite_13 stops
 * - Frame 55: DefineSprite_15 stops
 * - Frame 127: Cleanup begins
 * - DefineSprite_14: Continuous rotation at 10°/frame
 */
export class Spell109 extends BaseSpell {
  readonly spellId = 109;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const manifest: SpriteManifest = {
      width: 679.8,
      height: 575.4,
      offsetX: -285.6,
      offsetY: -352.8,
    };
    const anchor = calculateAnchor(manifest);

    // Create main animation
    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('anim1'),
        scale: init.scale,
        anchorX: anchor.x,
        anchorY: anchor.y,
        fps: 60,
        loop: false,
      })
    )
      .onFrame(0, () => {
        // Frame 1 in AS (0 in TS): Play sound
        this.callbacks.playSound('shield_cara');
      });

    // Add to container
    this.container.addChild(this.mainAnim.sprite);

    // Note: The ActionScript shows internal sprites with rotation behavior:
    // - DefineSprite_13: Random initial rotation (0-360°), stops at frame 28
    // - DefineSprite_14: Continuous rotation at 10°/frame
    // - DefineSprite_15: Stops at frame 55
    // These are embedded in the pre-rendered animation frames
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all registered animations
    this.anims.update(deltaTime);

    // Check completion
    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}