/**
 * Spell 1010 - Fronde de Pierre (Osamodas)
 *
 * Two-component spell:
 * - sprite_14: Looping grass/wind effect at target, plays sound "herbe" on load,
 *              jumps to random frame (1-30), plays "fronde" at frame 151, stops at frame 259
 * - sprite_15: Impact animation at target position, signals hit at frame 163,
 *              completes at frame 202
 *
 * Original AS timing:
 * - sprite_14 frame_1: playSound("herbe"), gotoAndPlay(random(30) + 1)
 * - sprite_14 frame_151: playSound("fronde")
 * - sprite_14 frame_259: stop()
 * - sprite_15 frame_1: position at cellTo
 * - sprite_15 frame_163: this.end() -> signalHit
 * - sprite_15 frame_202: removeMovieClip() -> complete
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SPRITE_14_MANIFEST: SpriteManifest = {
  width: 71.45,
  height: 107.85,
  offsetX: -36.9,
  offsetY: -78.3,
};

const SPRITE_15_MANIFEST: SpriteManifest = {
  width: 90.85,
  height: 142,
  offsetX: -44.1,
  offsetY: -95.65,
};

export class Spell1010 extends BaseSpell {
  readonly spellId = 1010;

  private sprite14Anim!: FrameAnimatedSprite;
  private sprite15Anim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const anchor14 = calculateAnchor(SPRITE_14_MANIFEST);
    const anchor15 = calculateAnchor(SPRITE_15_MANIFEST);

    // sprite_14: Looping grass/wind effect at target position
    // AS frame_1/DoAction_2.as: gotoAndPlay(random(30) + 1)
    // 0-indexed: random start frame = Math.floor(Math.random() * 30) + 0 = 0..29
    // AS random(30) returns 0..29, so gotoAndPlay(0+1)..gotoAndPlay(29+1) -> frames 1..30
    // 0-indexed: startFrame = 0..29
    const startFrame14 = Math.floor(Math.random() * 30);

    this.sprite14Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_14"),
        anchorX: anchor14.x,
        anchorY: anchor14.y,
        scale: init.scale,
        startFrame: startFrame14,
      })
    );

    this.sprite14Anim.sprite.position.set(init.targetX, init.targetY);

    this.sprite14Anim
      .stopAt(258)
      // Frame 0: playSound("herbe") - but since we start at a random frame,
      // the sound plays at the initial load (frame 1 in AS = frame 0 in TS)
      // The DoAction runs at frame 1 before the random jump. We simulate the sound
      // playing at initialization (frame 0 callback won't fire if startFrame > 0).
      // Per AS: frame_1/DoAction.as runs first (playSound), then DoAction_2 jumps.
      // Since we start at startFrame, we play the sound immediately in setup.
      .onFrame(150, () => this.callbacks.playSound("fronde"));

    // Play the "herbe" sound immediately (AS frame 1 DoAction runs before the jump)
    this.callbacks.playSound("herbe");

    this.container.addChild(this.sprite14Anim.sprite);

    // sprite_15: Impact animation at target position
    this.sprite15Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_15"),
        anchorX: anchor15.x,
        anchorY: anchor15.y,
        scale: init.scale,
      })
    );

    this.sprite15Anim.sprite.position.set(init.targetX, init.targetY);

    this.sprite15Anim
      .onFrame(162, () => this.signalHit())
      .onFrame(201, () => this.complete());

    this.container.addChild(this.sprite15Anim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
  }
}
