/**
 * Spell 711 - Grina
 *
 * A composite animation spell at the target position.
 * DefineSprite_30 is the outer container (anim1) that plays 129 frames and stops.
 * DefineSprite_29 contains 10 instances of DefineSprite_28 (spark/flash elements),
 * each starting at a random frame offset (0-9).
 * DefineSprite_28 each has a random rotation (-0 to -179 degrees) and stops at frame 37.
 * DefineSprite_23 contains a rotating element (DefineSprite_5) with decaying rotation velocity.
 * DefineSprite_5 has a flickering alpha (random 25-49 each frame).
 *
 * Components:
 * - anim1 (DefineSprite_30): Composite animation at target position, 129 frames, stops at frame 126
 *
 * Original AS timing:
 * - Frame 4 (DefineSprite_30): Play sound 'grina_711'
 * - Frame 127 (DefineSprite_30): removeMovieClip() / stop() - animation ends
 * - Each DefineSprite_28 instance: random rotation on load, stops at frame 37
 * - Each DefineSprite_28 instance: starts at random(10) frame
 * - DefineSprite_23 rotation: _rotation += (v *= 0.94575), v starts at 150
 * - DefineSprite_5 alpha: random(25) + 25 each frame
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
  width: 343,
  height: 181.5,
  offsetX: -172.75,
  offsetY: -90.55,
};

export class Spell711 extends BaseSpell {
  readonly spellId = 711;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anim1Textures = textures.getFrames("anim1");
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    const anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: anim1Textures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );

    anim.sprite.position.set(init.targetX, init.targetY);

    // Frame 4 in AS (1-indexed) = frame 3 (0-indexed): play sound
    anim.onFrame(3, () => this.callbacks.playSound("grina_711"));

    // Frame 127 in AS (1-indexed) = frame 126 (0-indexed): removeMovieClip / end
    anim.onFrame(126, () => this.signalHit());

    // stopFrame from manifest is 126 (0-indexed), matches frame_127/DoAction.as stop()
    anim.stopAt(126);

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
