/**
 * Spell 1101 - Autre
 *
 * Two-component spell:
 * - sprite_2 (486 frames): Main effect at target position, plays through to completion
 * - sprite_4 (144 frames): Secondary effect at target position, loops from frame 6 after frame 142,
 *   starts at a random frame (random(60))
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'autre_1101'
 * - Frame 137 (main): Signal hit (this.end())
 * - Frame 159 (main): removeMovieClip() - animation ends
 * - DefineSprite_4/frame_1: gotoAndPlay(random(60)) - start at random frame 0-59
 * - DefineSprite_4/frame_142: gotoAndPlay(6) - loop back to frame 6 (0-indexed: 5)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_2_MANIFEST: SpriteManifest = {
  width: 149.8,
  height: 149.85,
  offsetX: -84.2,
  offsetY: -78.15,
};

const SPRITE_4_MANIFEST: SpriteManifest = {
  width: 127.05,
  height: 506.7,
  offsetX: -108.95,
  offsetY: -493.5,
};

export class Spell1101 extends BaseSpell {
  readonly spellId = 1101;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // sprite_4: Secondary looping effect at target position
    // AS: frame_1 does gotoAndPlay(random(60)) -> start at random frame 0-59
    // AS: frame_142 does gotoAndPlay(6) -> loop back to frame 5 (0-indexed)
    const sprite4StartFrame = Math.floor(Math.random() * 60);
    const sprite4Anchor = calculateAnchor(SPRITE_4_MANIFEST);

    const sprite4Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_4"),
        anchorX: sprite4Anchor.x,
        anchorY: sprite4Anchor.y,
        scale: init.scale,
        startFrame: sprite4StartFrame,
        loop: false,
      })
    );
    sprite4Anim.sprite.position.set(init.targetX, init.targetY);
    // AS: frame_142 (0-indexed: 141) -> gotoAndPlay(6) (0-indexed: 5)
    // We implement this as a callback that resets to frame 5
    sprite4Anim.onFrame(
      141,
      () => {
        sprite4Anim.gotoFrame(5);
      },
      false
    );
    this.container.addChild(sprite4Anim.sprite);

    // sprite_2: Main effect at target position, 486 frames, stops at frame 158 (AS frame 159)
    const sprite2Anchor = calculateAnchor(SPRITE_2_MANIFEST);

    const sprite2Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_2"),
        anchorX: sprite2Anchor.x,
        anchorY: sprite2Anchor.y,
        scale: init.scale,
      })
    );
    sprite2Anim.sprite.position.set(init.targetX, init.targetY);
    // AS frame 1 (0-indexed: 0): play sound
    sprite2Anim.onFrame(0, () => this.callbacks.playSound("autre_1101"));
    // AS frame 137 (0-indexed: 136): signal hit
    sprite2Anim.onFrame(136, () => this.signalHit());
    // AS frame 159 (0-indexed: 158): removeMovieClip -> stop here
    sprite2Anim.stopAt(158);
    this.container.addChild(sprite2Anim.sprite);
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
