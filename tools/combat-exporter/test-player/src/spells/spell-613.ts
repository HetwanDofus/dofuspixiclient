/**
 * Spell 613 - Dodge
 *
 * A dodge animation with a flickering overlay effect.
 *
 * Components:
 * - anim1: Main animation at target position, 126 frames
 *   - Inner sprite (DefineSprite_6): Randomly cycles through 6 sub-frames each enterFrame,
 *     with random alpha. Loops from frame 40 back to frame 4.
 *   - Outer timeline (DefineSprite_8): Plays through 79 frames total.
 *
 * Original AS timing:
 * - Frame 4  (DefineSprite_8): Play sound 'dodge_613a'
 * - Frame 67 (DefineSprite_8): Play sound 'dodge_613b'
 * - Frame 79 (DefineSprite_8): removeMovieClip() - animation ends
 *
 * The inner sprite (DefineSprite_6) flickers randomly each frame (random frame 1-6,
 * random alpha 0-99). It loops: at frame 40 it jumps back to frame 4.
 *
 * Since anim1 is a composite (isComposite: true) with 126 frames total, and
 * DefineSprite_8 ends at frame 79 (removeMovieClip), we signal completion at
 * frame 78 (0-indexed).
 *
 * Sounds from manifest:
 * - Frame 3 (0-indexed): 'dodge_613a'  (AS frame 4)
 * - Frame 66 (0-indexed): 'dodge_613b' (AS frame 67)
 *
 * Hit signal: at frame 3 (same as first sound / impact start)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 246.35,
  height: 617.55,
  offsetX: -124.85,
  offsetY: -534.4,
};

export class Spell613 extends BaseSpell {
  readonly spellId = 613;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 3 (0-indexed, AS frame 4): play sound + signal hit
    this.mainAnim.onFrame(3, () => {
      this.callbacks.playSound('dodge_613a');
      this.signalHit();
    });

    // Frame 66 (0-indexed, AS frame 67): play sound
    this.mainAnim.onFrame(66, () => {
      this.callbacks.playSound('dodge_613b');
    });

    // Frame 78 (0-indexed, AS frame 79): removeMovieClip -> complete
    this.mainAnim.onFrame(78, () => {
      this.complete();
    });

    this.mainAnim.addTo(this.container);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.mainAnim.isComplete()) {
      this.complete();
    }
  }
}
