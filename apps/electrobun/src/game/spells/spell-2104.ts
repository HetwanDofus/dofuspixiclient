/**
 * Spell 2104
 *
 * A shoot animation with wobble rotation effects.
 *
 * Components:
 * - shoot (DefineSprite_10_shoot): Main animation, 93 frames, positioned at target
 *   - Contains DefineSprite_11_move (wobble child): rotation = 90 + a * cos(i += 0.6), a /= 1.1
 *   - Contains DefineSprite_9 (wobble child): rotation = 90 + a * cos(i += pi), a /= 1.3
 *
 * Original AS timing:
 * - DefineSprite_9/frame_64: stop()
 * - DefineSprite_10_shoot/frame_91: _parent.removeMovieClip() -> signal hit + complete
 * - DefineSprite_11_move wobble: a=30, i=0, each frame: rotation = 90 + a*cos(i+=0.6), a/=1.1
 * - DefineSprite_9 wobble: a=10, i=0, each frame: rotation = 90 + a*cos(i+=pi), a/=1.3
 *
 * Since the exported "shoot" animation is a composite of all children rendered together,
 * we simply play the shoot animation. The wobble children are baked into the composite frames.
 * Hit is signaled at frame 90 (0-indexed, AS frame 91 = removeMovieClip).
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 29.75,
  height: 31.6,
  offsetX: -23.25,
  offsetY: -17.6,
};

export class Spell2104 extends BaseSpell {
  readonly spellId = 2104;

  private shootAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // AS frame 91 (0-indexed: 90) -> removeMovieClip() -> signal hit and complete
    this.shootAnim.onFrame(90, () => {
      this.signalHit();
    });

    this.container.addChild(this.shootAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    if (this.anims.allComplete()) {
      this.complete();
    }
  }
}
