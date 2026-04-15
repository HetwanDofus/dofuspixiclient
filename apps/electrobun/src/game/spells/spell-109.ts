/**
 * Spell 109 - Carapace (Bouclier)
 *
 * A shield/armor spell animation played at the target position.
 *
 * Components:
 * - anim1: Composite animation at target position, plays through 129 frames
 *
 * The animation is a composite (isComposite: true) meaning it contains
 * multiple sub-sprites rendered together:
 * - DefineSprite_17 (outer): Plays sound at frame 1, removes at frame 127
 * - DefineSprite_13 (inner rotating element): Random initial rotation, stops at frame 28
 * - DefineSprite_14 (spinning element): Rotates +10 degrees per frame continuously
 * - DefineSprite_15 (another element): Stops at frame 55
 *
 * Since anim1 is a composite pre-rendered animation, we just play it as a
 * single sprite sequence.
 *
 * Original AS timing:
 * - Frame 1 (DefineSprite_17): Play sound 'shield_cara'
 * - Frame 28 (DefineSprite_13): stop()
 * - Frame 55 (DefineSprite_15): stop()
 * - Frame 127 (DefineSprite_17): removeMovieClip() - animation ends
 * - DefineSprite_13 frame 1: _rotation = random(360) (random initial rotation)
 * - DefineSprite_14 enterFrame: _rotation += 10 (continuous spin)
 *
 * Hit signal: at frame 0 (instant effect on target)
 * Completion: when anim1 finishes (frame 128, 0-indexed)
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
  width: 113.3,
  height: 95.9,
  offsetX: -47.6,
  offsetY: -58.8,
};

export class Spell109 extends BaseSpell {
  readonly spellId = 109;

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

    // Frame 0 (AS frame 1): play sound 'shield_cara'
    this.mainAnim.onFrame(0, () => this.callbacks.playSound("shield_cara"));

    // Signal hit immediately when the spell reaches target (frame 0)
    this.mainAnim.onFrame(0, () => this.signalHit());

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
