/**
 * Spell 1210 - Duplicate (Pandawa)
 *
 * A single composite animation played at the target position.
 * The animation has two possible playback directions based on angle:
 * - If |angle| > 90, the X scale is flipped
 * - If angle < 0, playback starts at frame 148 (0-indexed: 147)
 * - frame 127 (0-indexed: 126): removeMovieClip (end of forward path)
 * - frame 271 (0-indexed: 270): removeMovieClip (end of reverse path)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'panda_vague'
 * - Frame 1 (DefineSprite_18_duplicate): Flip xscale if |angle|>90, jump to 148 if angle<0
 * - Frame 127: removeMovieClip (forward direction end)
 * - Frame 271: removeMovieClip (reverse direction end)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const DUPLICATE_MANIFEST: SpriteManifest = {
  width: 134.95,
  height: 119.8,
  offsetX: -58.7,
  offsetY: -57.35,
};

export class Spell1210 extends BaseSpell {
  readonly spellId = 1210;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const angle = context?.angle ?? 0;

    // Determine playback direction per AS:
    // if (angle < 0) gotoAndPlay(148) -> 0-indexed: startFrame = 147
    // stop frame: if angle < 0 -> frame 271 (0-indexed: 270), else frame 127 (0-indexed: 126)
    const startFrame = angle < 0 ? 147 : 0;
    const stopFrame = angle < 0 ? 270 : 126;

    const anchor = calculateAnchor(DUPLICATE_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('duplicate'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
      startFrame,
    }));

    // Position at target
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // AS: if (Math.abs(_parent.angle) > 90) { _xscale = -_xscale; }
    if (Math.abs(angle) > 90) {
      this.mainAnim.sprite.scale.x = -this.mainAnim.sprite.scale.x;
    }

    // Sound at frame 0 (main timeline frame 1)
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('panda_vague'));

    // Signal hit at start of impact (when animation begins showing effect)
    // Use frame 0 or the chosen start frame for hit signal
    this.mainAnim.onFrame(startFrame === 147 ? 147 : 0, () => this.signalHit());

    this.mainAnim.stopAt(stopFrame);

    this.container.addChild(this.mainAnim.sprite);
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
