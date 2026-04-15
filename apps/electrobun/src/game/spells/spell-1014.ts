/**
 * Spell 1014 - Licorne (Eniripsa)
 *
 * A sprite animation that positions at the target cell and plays through.
 *
 * Components:
 * - sprite_17: Main animation at target position, 120 frames
 *   - Frame 1: Sets position to cellTo
 *   - Frame 28: Play sound 'licrounch_1014'
 *   - Frame 88: Signal hit (this.end())
 *   - Frame 106: Play sound 'jump'
 *   - Frame 118: removeMovieClip() - animation ends
 * - sprite_11: Decorative swirl, randomized rotation/scale/start frame
 *   - Frame 1: Random rotation, random scale (50-99%), random start frame (0-26)
 *
 * Original AS timing:
 * - Frame 28 (sprite_17): Play sound 'licrounch_1014'
 * - Frame 88 (sprite_17): Signal hit
 * - Frame 106 (sprite_17): Play sound 'jump'
 * - Frame 118 (sprite_17): Animation ends
 * - sprite_11 frame_1: _rotation = random(360), t = random(50)+50, gotoAndPlay(random(27)+1)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_17_MANIFEST: SpriteManifest = {
  width: 107.95,
  height: 85.85,
  offsetX: -21.55,
  offsetY: -79.75,
};

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 75.05,
  height: 1,
  offsetX: 9.7,
  offsetY: -0.5,
};

export class Spell1014 extends BaseSpell {
  readonly spellId = 1014;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // sprite_17: Main animation at target position
    const sprite17Anchor = calculateAnchor(SPRITE_17_MANIFEST);
    const mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_17"),
        anchorX: sprite17Anchor.x,
        anchorY: sprite17Anchor.y,
        scale: init.scale,
      })
    );

    // AS frame_1: _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    // Position at target cell (relative to container which is at cellFrom)
    mainAnim.sprite.position.set(init.targetX, init.targetY);

    // AS frame_28: SOMA.playSound("licrounch_1014") -> 0-indexed: frame 27
    mainAnim.onFrame(27, () => this.callbacks.playSound("licrounch_1014"));

    // AS frame_88: this.end() -> 0-indexed: frame 87
    mainAnim.onFrame(87, () => this.signalHit());

    // AS frame_106: SOMA.playSound("jump") -> 0-indexed: frame 105
    mainAnim.onFrame(105, () => this.callbacks.playSound("jump"));

    // AS frame_118: _parent.removeMovieClip() -> 0-indexed: frame 117
    mainAnim.stopAt(117);

    this.container.addChild(mainAnim.sprite);

    // sprite_11: Decorative swirl with randomized properties
    // AS frame_1/DoAction:
    //   _rotation = random(360)         -> Math.floor(Math.random() * 360)
    //   t = random(50) + 50             -> Math.floor(Math.random() * 50) + 50
    //   _xscale = t; _yscale = t        -> scale = t / 100
    //   if(c != 1) { c = 1; gotoAndPlay(random(27) + 1) } -> startFrame = Math.floor(Math.random() * 27) + 1 (1-indexed -> 0-indexed: Math.floor(Math.random() * 27) + 0, but +1 in AS means frame 1-27 -> 0-indexed: 1-27, but random(27) gives 0-26, +1 gives 1-27 -> 0-indexed: 0-26)
    // AS gotoAndPlay(random(27) + 1): random(27) = 0..26, +1 = 1..27 (1-indexed) -> 0-indexed: 0..26
    const rotation = Math.floor(Math.random() * 360);
    const t = Math.floor(Math.random() * 50) + 50;
    const asScale = t / 100;
    const startFrame = Math.floor(Math.random() * 27); // random(27) = 0..26 -> gotoAndPlay(0+1)=1 -> 0-indexed: 0..26

    const sprite11Anchor = calculateAnchor(SPRITE_11_MANIFEST);
    const swirlAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_11"),
        anchorX: sprite11Anchor.x,
        anchorY: sprite11Anchor.y,
        scale: init.scale * asScale,
        startFrame,
      })
    );

    swirlAnim.sprite.position.set(init.targetX, init.targetY);
    swirlAnim.sprite.rotation = (rotation * Math.PI) / 180;

    this.container.addChild(swirlAnim.sprite);
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
