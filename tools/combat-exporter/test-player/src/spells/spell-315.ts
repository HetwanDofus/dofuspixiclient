/**
 * Spell 315 - (Enutrof/Xelor composite animation)
 *
 * A single composite animation (anim1) that plays from start to finish.
 * The animation contains an internal DefineSprite_53 that removes itself
 * at frame 157 (AS 1-indexed), meaning the main timeline ends at frame 156 (0-indexed).
 *
 * Components:
 * - anim1: Composite animation at target position, 201 frames total
 *
 * Original AS timing:
 * - DefineSprite_51/frame_1: gotoAndPlay(random(18) + 2) - random start for sub-loops
 * - DefineSprite_51/frame_4: _rotation = random(360) - random rotation
 * - DefineSprite_51/frame_28: gotoAndPlay(2) - loop back
 * - DefineSprite_53/frame_157: _parent.removeMovieClip() - ends at AS frame 157 (index 156)
 *
 * Hit signal: At the start (frame 0) since this is a self-targeted/instant effect
 * Completion: When anim1 reaches frame 156 (AS frame 157 = removeMovieClip)
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 195.95,
  height: 87.15,
  offsetX: -29.95,
  offsetY: -128.65,
};

export class Spell315 extends BaseSpell {
  readonly spellId = 315;

  private anim1!: FrameAnimatedSprite;

  protected setup(_context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.anim1 = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    // Position at target
    this.anim1.sprite.position.set(init.targetX, init.targetY);

    // DefineSprite_53/frame_157 (AS 1-indexed) -> frame index 156 (0-indexed)
    // _parent.removeMovieClip() -> stop and signal completion
    this.anim1.stopAt(156);

    // Signal hit at start (instant/self effect)
    this.anim1.onFrame(0, () => this.signalHit());

    this.anim1.addTo(this.container);
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
