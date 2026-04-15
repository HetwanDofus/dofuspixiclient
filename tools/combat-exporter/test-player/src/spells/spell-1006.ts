/**
 * Spell 1006 - Craquement (Eniripsa)
 *
 * A single composite animation played at the target position.
 *
 * Components:
 * - anim1: Composite animation at target position, stops at frame 128
 *
 * Original AS timing:
 * - DefineSprite_5/frame_1: gotoAndPlay(random(15) + 1) — random start frame 1-15
 * - DefineSprite_5/frame_149: stop()
 * - DefineSprite_37/frame_97: this.end() — signal hit
 * - DefineSprite_37/frame_129: _parent.removeMovieClip() — animation ends
 *
 * The main animation (DefineSprite_37) plays through:
 * - Frame 97 (0-indexed: 96): signal hit
 * - Frame 129 (0-indexed: 128): stop/complete
 *
 * DefineSprite_5 is the inner looping sub-sprite that starts at a random frame
 * (random(15) + 1 → 0-indexed: random start 0–14), and the composite anim1
 * captures its full rendered output across all 130 frames.
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 96.75,
  height: 76.1,
  offsetX: -36.1,
  offsetY: -64.2,
};

export class Spell1006 extends BaseSpell {
  readonly spellId = 1006;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    // Random start frame: AS gotoAndPlay(random(15) + 1) → 0-indexed: 0–14
    const startFrame = Math.floor(Math.random() * 15);

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('anim1'),
        fps: 50,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        startFrame,
      }),
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    // Frame 97 (0-indexed: 96): this.end() → signal hit
    anim.onFrame(96, () => this.signalHit());

    // Frame 129 (0-indexed: 128): removeMovieClip / stop → complete
    anim.stopAt(128);
    anim.onFrame(128, () => this.complete());

    this.container.addChild(anim.sprite);
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
