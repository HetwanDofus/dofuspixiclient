/**
 * Spell 1012 - Herbe (Sadida)
 *
 * Two-component spell animation:
 * - sprite_17: Caster effect, starts at a random frame (1-60 + 2), plays sound at frame 64,
 *              stops at frame 196
 * - sprite_18: Target effect, positioned at cellTo, signals hit at frame 67,
 *              completes at frame 184
 *
 * Original AS timing:
 * - sprite_17 frame_1: gotoAndPlay(random(60) + 2) -> start at frame 1..61 (0-indexed: 1..61)
 * - sprite_17 frame_64: SOMA.playSound("herbe")  (0-indexed: 63)
 * - sprite_17 frame_196: stop()                  (0-indexed: 195)
 * - sprite_18 frame_1: _X = _parent.cellTo.x; _Y = _parent.cellTo.y (position at target)
 * - sprite_18 frame_67: this.end()               (0-indexed: 66)
 * - sprite_18 frame_184: _parent.removeMovieClip(); stop() (0-indexed: 183)
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
  width: 57.5,
  height: 62.15,
  offsetX: -28,
  offsetY: -55.15,
};

const SPRITE_18_MANIFEST: SpriteManifest = {
  width: 169.5,
  height: 104.4,
  offsetX: -85.55,
  offsetY: -59.3,
};

export class Spell1012 extends BaseSpell {
  readonly spellId = 1012;

  private casterAnim!: FrameAnimatedSprite;
  private targetAnim!: FrameAnimatedSprite;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // sprite_17: caster effect
    // AS frame_1: gotoAndPlay(random(60) + 2) -> AS frames 2..62 -> 0-indexed: 1..61
    const startFrame17 = Math.floor(Math.random() * 60) + 1;

    const anchor17 = calculateAnchor(SPRITE_17_MANIFEST);
    this.casterAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_17"),
        anchorX: anchor17.x,
        anchorY: anchor17.y,
        scale: init.scale,
        startFrame: startFrame17,
      })
    );

    // Position at caster (origin of container)
    this.casterAnim.sprite.position.set(0, init.casterY);

    // AS frame_64 (0-indexed: 63): play sound "herbe"
    this.casterAnim.onFrame(63, () => this.callbacks.playSound("herbe"));

    // AS frame_196 (0-indexed: 195): stop()
    this.casterAnim.stopAt(195);

    this.container.addChild(this.casterAnim.sprite);

    // sprite_18: target effect
    // AS frame_1: _X = _parent.cellTo.x; _Y = _parent.cellTo.y
    const anchor18 = calculateAnchor(SPRITE_18_MANIFEST);
    this.targetAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_18"),
        anchorX: anchor18.x,
        anchorY: anchor18.y,
        scale: init.scale,
      })
    );

    // Position at target cell
    this.targetAnim.sprite.position.set(init.targetX, init.targetY);

    // AS frame_67 (0-indexed: 66): this.end() -> signal hit
    this.targetAnim.onFrame(66, () => this.signalHit());

    // AS frame_184 (0-indexed: 183): stop
    this.targetAnim.stopAt(183);

    this.container.addChild(this.targetAnim.sprite);
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
