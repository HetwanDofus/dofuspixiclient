/**
 * Spell 311 - (Earth/Feca spell)
 *
 * A ground-targeted effect that plays at the target cell position.
 *
 * Components:
 * - sprite_21: Main animation at target cell position (99 frames)
 *   - Two sub-elements with per-frame alpha randomization and rotation
 *
 * Original AS timing:
 * - Frame 1 (sprite_21): Position at cellTo.x, cellTo.y
 * - Frame 70 (sprite_21): this.end() - signal hit
 * - Frame 97 (sprite_21): removeMovieClip() - animation ends (0-indexed: 96)
 *
 * Sub-element behaviors (per enterFrame):
 * - PlaceObject2_6_1: _alpha = 0 + random(120) each frame
 * - PlaceObject2_8_3: _alpha = random(100) + 90; _rotation += 10 each frame
 *   (These are baked into the composite sprite frames)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_21_MANIFEST: SpriteManifest = {
  width: 85.5,
  height: 461.3,
  offsetX: -43.85,
  offsetY: -456.05,
};

export class Spell311 extends BaseSpell {
  readonly spellId = 311;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(SPRITE_21_MANIFEST);

    const mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_21'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // AS frame 1: _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // Position at target cell (relative to container which is at cellFrom)
    mainAnim.sprite.position.set(init.targetX, init.targetY - init.casterY);

    // AS frame 70 (0-indexed: 69): this.end() - signal hit
    mainAnim.onFrame(69, () => this.signalHit());

    // AS frame 97 (0-indexed: 96): removeMovieClip() - animation ends
    mainAnim.stopAt(96);

    this.container.addChild(mainAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allStopped()) {
      this.complete();
    }
  }
}
