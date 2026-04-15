/**
 * Spell 407 - Explosion
 *
 * A radial explosion effect with multiple randomized instances of a sprite (DefineSprite_6)
 * placed at the target position. Each instance has a random rotation and scale.
 *
 * Components:
 * - anim1 (composite): 96 frames, each frame spawning one instance of DefineSprite_6
 *   Actually: anim1 is a composite animation used as the background/base.
 *   DefineSprite_6 instances are the individual explosion particles, each:
 *     - Random rotation: -40 - random(100) degrees
 *     - Random scale: random(50) + 30 percent (30-79%)
 *     - Stops at frame 52 (0-indexed: 51)
 *   DefineSprite_7 removes parent at frame 94 (0-indexed: 93)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'explosion'
 * - Frame 1 (DefineSprite_6): Set random rotation and scale
 * - Frame 52 (DefineSprite_6): stop()
 * - Frame 94 (DefineSprite_7): _parent.removeMovieClip()
 *
 * The main animation (anim1) is the composite of all these sprites.
 * We render it as a single FrameAnimatedSprite since it's marked isComposite: true.
 * Hit is signaled at frame 1 (when explosion starts / sound plays).
 * Animation completes after 96 frames.
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const ANIM1_MANIFEST: SpriteManifest = {
  width: 204.95,
  height: 85.55,
  offsetX: -44.05,
  offsetY: -85.55,
};

export class Spell407 extends BaseSpell {
  readonly spellId = 407;

  private mainAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        fps: 60,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound and signal hit
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound("explosion");
      this.signalHit();
    });

    this.container.addChild(this.mainAnim.sprite);
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
