/**
 * Spell 104 - Arty
 *
 * A single composite animation played at the target position.
 * The inner sprite (DefineSprite_5) flickers alpha randomly each frame
 * and stops at frame 28. The outer container (DefineSprite_8) rotates
 * +1 degree each frame and ends at frame 130.
 *
 * Components:
 * - anim1: 132-frame composite animation at target position
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'arty_104'
 * - Frame 61 (DefineSprite_7): _rotation = -20 (baked into composite frames)
 * - Frame 1 (DefineSprite_8 child, enterFrame): _rotation += 1 each frame (baked)
 * - Frame 28 (DefineSprite_5): stop() (baked into composite frames)
 * - Frame 130 (DefineSprite_8): this.end() -> signal hit and complete
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 188.95,
  height: 190.8,
  offsetX: -91.3,
  offsetY: -127.65,
};

export class Spell104 extends BaseSpell {
  readonly spellId = 104;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('anim1'),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      }),
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound 'arty_104'
    anim.onFrame(0, () => this.callbacks.playSound('arty_104'));

    // Frame 130 (0-indexed: 129): this.end() -> signal hit then complete
    anim.onFrame(129, () => {
      this.signalHit();
      this.complete();
    });

    anim.addTo(this.container);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.signalHit();
      this.complete();
    }
  }
}
