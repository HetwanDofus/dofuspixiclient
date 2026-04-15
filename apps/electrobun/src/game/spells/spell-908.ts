/**
 * Spell 908 - Wab
 *
 * A shoot animation with a spiraling/wobbling motion effect.
 *
 * Components:
 * - shoot (DefineSprite_6_shoot): 84-frame animation at target position
 *   with rotation = 0, plays sound at frame 4, ends at frame 70
 *
 * The "move" child (DefineSprite_13_move) has a wobble effect:
 * - Initial scale: t = 10 + 3 * level (percentage)
 * - Rotation: 90 + a * cos(i += 0.5), where a decays by 1.1 each frame
 * - This is baked into the shoot sprite frames
 *
 * Original AS timing:
 * - Frame 1 (shoot): _rotation = 0
 * - Frame 4 (shoot): SOMA.playSound("wab_2005b")
 * - Frame 70 (shoot): _parent.removeMovieClip() → animation ends
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
  width: 177.7,
  height: 141.7,
  offsetX: -89.05,
  offsetY: -88.5,
};

export class Spell908 extends BaseSpell {
  readonly spellId = 908;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);

    const shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        fps: 60,
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );

    // AS frame_1: _rotation = 0 (default, no rotation)
    shootAnim.sprite.rotation = 0;
    shootAnim.sprite.position.set(init.targetX, init.targetY);

    // AS frame_4 (0-indexed: 3): play sound
    shootAnim.onFrame(3, () => {
      this.callbacks.playSound("wab_2005b");
    });

    // AS frame_70 (0-indexed: 69): removeMovieClip → signal hit and end
    shootAnim.onFrame(69, () => {
      this.signalHit();
    });

    // Stop at frame 69 (AS frame 70 calls removeMovieClip + stop)
    shootAnim.stopAt(69);

    this.container.addChild(shootAnim.sprite);
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
