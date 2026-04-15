/**
 * Spell 2907 - (Unknown Name)
 *
 * A candle/flame effect with oscillating animation at the target position.
 * The composite animation (anim1) plays through 390 frames and stops at frame 387.
 *
 * Components:
 * - anim1: Composite animated sprite at target position, 390 frames, stops at 387
 *
 * Original AS timing:
 * - frame_13/DoAction.as: stop() — but this is inside a nested DefineSprite context;
 *   the main timeline stops at frame 13 (index 12), however the composite anim1
 *   encodes all the oscillation/particle behavior internally across its 390 frames.
 * - DefineSprite_9/frame_388: removeMovieClip() + stop() — particle self-removes at frame 388 (index 387)
 * - The sprite has stopFrame=387 per the manifest, so we stop at frame 387.
 *
 * Internal AS behavior (encoded in the composite frames):
 * - DefineSprite_8 (oscillating X): _X = 10 * Math.sin(i += vamp), vamp = 0.1 * Math.random()
 * - DefineSprite_7 (oscillating rotation inner): _rotation = 10 * Math.sin(a += _parent.vamp)
 * - DefineSprite_4 (oscillating rotation outer): _rotation = 20 * Math.sin(a += _parent._parent._parent.vamp)
 * - DefineSprite_5 (oscillating rotation mid): _rotation = 15 * Math.sin(a += _parent._parent.vamp)
 * - DefineSprite_9 (floating particle): _X += vent, _Y -= vy, fades after t > 330
 *
 * Since anim1 is marked isComposite=true and has 390 pre-rendered frames, all the
 * oscillation math is baked into the frames. We simply play through them.
 *
 * Hit signal: frame 0 (instant, on-target spell)
 * Completion: when anim1 stops at frame 387
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 13.3,
  height: 36.45,
  offsetX: -5.9,
  offsetY: -54.15,
};

export class Spell2907 extends BaseSpell {
  readonly spellId = 2907;

  private anim1!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.anim1 = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames('anim1'),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      }),
    );

    this.anim1.sprite.position.set(init.targetX, init.targetY);

    // Manifest stopFrame = 387 (0-indexed), matches DefineSprite_9 frame_388 DoAction (1-indexed 388 -> 0-indexed 387)
    this.anim1.stopAt(387);

    // Signal hit immediately (on-target instant effect)
    this.anim1.onFrame(0, () => this.signalHit());

    this.container.addChild(this.anim1.sprite);
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
