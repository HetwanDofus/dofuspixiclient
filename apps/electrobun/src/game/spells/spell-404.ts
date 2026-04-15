/**
 * Spell 404 - Lakam
 *
 * A decorative spell that spawns 11 "tige" (stem) instances arranged in a
 * circular pattern using sine/cosine math. Each tige is positioned and scaled
 * based on an incrementing angle (_parent.i), creating a flower/circle effect.
 *
 * Components:
 * - anim1: Main animation at target position, 372 frames, stops at frame 366
 * - 11 tige sprites: Spawned one per frame, positioned via sin/cos of angle i
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'lakam_404'
 * - DefineSprite_6 frame_1: Spawns 11 tiges over 11 frames (c=0..10), i starts at -PI
 * - DefineSprite_6 frame_367: removeMovieClip() + stop()
 * - DefineSprite_4 frame_193: stop()
 * - DefineSprite_3 frame_148: stop()
 *
 * Tige positioning (frame_1/DoAction.as for each tige):
 *   _X = 15 * Math.sin(i)
 *   _Y = 10 * Math.cos(i)
 *   _xscale = 50 * Math.cos(i)   -> scaleX = 0.5 * cos(i)
 *   if (_Y < 0) { _alpha = 100 * Math.cos(i) + 100 }  -> alpha = cos(i) + 1
 *
 * i starts at -PI and increments by 0.5 for each tige spawned.
 * So tige 0 uses i=-PI, tige 1 uses i=-PI+0.5, ..., tige 10 uses i=-PI+5.0
 *
 * Hit signal: The main animation signals hit partway through (around when
 * DefineSprite_4 stops at frame 193, i.e. index 192).
 * Complete: when main animation stops at frame 366 (0-indexed: 365).
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container, Sprite } from "pixi.js";

const TIGE_MANIFEST: SpriteManifest = {
  width: 152.15,
  height: 141.5,
  offsetX: -72.7,
  offsetY: -119.2,
};

export class Spell404 extends BaseSpell {
  readonly spellId = 404;

  private tigeSprites: Sprite[] = [];
  private tigeContainer!: Container;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Main animation (anim1) at target position
    const mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("anim1"),
        anchorX: 0.5,
        anchorY: 0.5,
        scale: init.scale,
      })
    );
    mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): play sound
    mainAnim.onFrame(0, () => this.callbacks.playSound("lakam_404"));

    // Hit signal around when DefineSprite_4 stops (frame 193 AS = index 192)
    mainAnim.onFrame(192, () => this.signalHit());

    // Stop at frame 366 (0-indexed: 365, matching manifest stopFrame)
    mainAnim.stopAt(365);

    this.container.addChild(mainAnim.sprite);

    // Container for tige sprites, positioned at target
    this.tigeContainer = new Container();
    this.tigeContainer.position.set(init.targetX, init.targetY);
    this.tigeContainer.scale.set(init.scale);
    this.container.addChild(this.tigeContainer);

    // Spawn 11 tige sprites immediately (DefineSprite_6 spawns them over 11 frames,
    // but since we don't have a separate timeline for DefineSprite_6 with its own
    // frame counter, we spawn all 11 upfront with their correct i values)
    //
    // AS: _parent.i = -3.1415; then for c=0..10: attachMovie("tige", ...), i += 0.5
    // So tige 0 gets i=-PI (approx), tige c gets i=-PI + c*0.5
    // Note: AS uses -3.1415 (not exact PI), so we use that exact value.
    const tigeTextures = textures.getFrames("lib_tige");
    const tigeAnchor = calculateAnchor(TIGE_MANIFEST);

    let angleI = -Math.PI;
    for (let c = 0; c < 11; c++) {
      const i = angleI;

      const sprite = new Sprite(tigeTextures[0]);
      sprite.anchor.set(tigeAnchor.x, tigeAnchor.y);

      // _X = 15 * Math.sin(i)
      sprite.x = 15 * Math.sin(i);
      // _Y = 10 * Math.cos(i)
      sprite.y = 10 * Math.cos(i);

      // _xscale = 50 * Math.cos(i) -> scaleX = 0.5 * cos(i)
      const cosI = Math.cos(i);
      sprite.scale.set(0.5 * cosI, 1);

      // Default alpha = 100% (fully opaque)
      // if (_Y < 0) { _alpha = 100 * Math.cos(i) + 100 }
      // _Y = 10 * cos(i); _Y < 0 means cos(i) < 0
      if (sprite.y < 0) {
        // _alpha is 0-100 in AS, PixiJS alpha is 0-1
        const asAlpha = 100 * cosI + 100;
        sprite.alpha = asAlpha / 100;
      }

      this.tigeSprites.push(sprite);
      this.tigeContainer.addChild(sprite);

      angleI += 0.5;
    }
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

  destroy(): void {
    this.tigeSprites = [];
    super.destroy();
  }
}
