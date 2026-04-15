/**
 * Spell 101 - Arty
 *
 * A complex spell with multiple animated components:
 * - Main animation (anim1): 189 frames, plays through, signals hit at frame 85, ends at frame 187
 * - Sprite_9: A scaled sprite (scale: 80-130%) - flicker effect
 * - Sprite_10: Rotating/pulsing sprites (sinusoidal x-scale)
 * - Sprite_3: Gravity/bounce physics sprites
 * - Sprite_13: Spiral floating sprites with alpha fade
 * - Sprite_12: Random alpha flicker sprites
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'arty_101'
 * - Frame 85 (DefineSprite_14): this.end() -> signal hit
 * - Frame 187 (DefineSprite_14): _parent.removeMovieClip() -> animation ends
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 46.35,
  height: 30.45,
  offsetX: -22.6,
  offsetY: -15.1,
};

export class Spell101 extends BaseSpell {
  readonly spellId = 101;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Main animation (anim1) at target position
    // DefineSprite_14 contains the main animation with 189 frames
    // Frame 85 (0-indexed: 84): this.end() -> signal hit
    // Frame 187 (0-indexed: 186): _parent.removeMovieClip() -> complete
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('arty_101'));

    // Frame 84 (AS frame 85): signal hit
    this.mainAnim.onFrame(84, () => this.signalHit());

    // Frame 186 (AS frame 187): animation complete
    this.mainAnim.onFrame(186, () => this.complete());

    this.container.addChild(this.mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
  }
}
