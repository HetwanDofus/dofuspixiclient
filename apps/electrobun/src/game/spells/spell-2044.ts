/**
 * Spell 2044 - Duplic
 *
 * A trail of duplicate sprites spawned one per frame, traveling from caster to target.
 *
 * Components:
 * - Multiple 'duplic' instances spawned each frame along the path from caster to target
 * - Each duplic has random scale (10-59%), random rotation (0-359°)
 * - Positioned along the line from caster to target based on step index
 * - Two duplication layers per step (c and c+100 depth levels in AS)
 * - After all steps done, signals hit, then waits 20 frames before completing
 *
 * Original AS timing:
 * - onLoad: compute dx, dy, d, inte = round(d/13), ix = dx/inte, iy = dy/inte
 * - onEnterFrame: each frame while c < inte: attachMovie("duplic", ..., c) and attachMovie("duplic", ..., c+100); c++
 * - When c >= inte: call this.end() (once), then t2++ until t2==20 -> removeMovieClip
 * - duplic frame_1: t = random(50)+10; _xscale=t; _yscale=t; _rotation=random(360); _X=_parent.c*_parent.ix; _Y=_parent.c*_parent.iy
 * - duplic frame_34: removeMovieClip / stop (36 frames total, so lasts 35 more frames)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import type { Texture } from "pixi.js";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const DUPLIC_MANIFEST: SpriteManifest = {
  width: 84.6,
  height: 68.9,
  offsetX: -21.1,
  offsetY: -45.65,
};

export class Spell2044 extends BaseSpell {
  readonly spellId = 2044;

  private duplicTextures: Texture[] = [];

  // Spawn state
  private ix = 0;
  private iy = 0;
  private inte = 0;
  private c = 0;
  private spawnDone = false;
  private lok = false;
  private t2 = 0;

  // Per-frame accumulator for spawning (at 40 FPS)
  private frameAccumulator = 0;
  private readonly frameTime = 1000 / 40;

  // All per-duplic animations (managed manually since count is dynamic)
  private duplicAnims: FrameAnimatedSprite[] = [];

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Get the duplic textures
    this.duplicTextures = textures.getFrames("lib_duplic");

    // AS onLoad calculations:
    // _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25;
    // _parent.a._x = _parent.cellTo.x; _parent.a._y = _parent.cellTo.y - 25;
    // dx = -_X + _parent.a._x = cellTo.x - cellFrom.x
    // dy = -_Y + _parent.a._y = (cellTo.y-25) - (cellFrom.y-25) = cellTo.y - cellFrom.y
    // (The -25 offsets cancel out in the delta)
    const dx = init.targetX; // cellTo.x - cellFrom.x

    // targetY = (cellTo.y - cellFrom.y) + Y_OFFSET, Y_OFFSET = -50
    // We need raw dy = cellTo.y - cellFrom.y = targetY - Y_OFFSET = targetY + 50
    const dy = init.targetY + 50;

    const d = Math.sqrt(dx * dx + dy * dy);
    this.inte = Math.round(d / 13);

    if (this.inte <= 0) {
      this.inte = 1;
    }

    this.ix = dx / this.inte;
    this.iy = dy / this.inte;
    this.c = 0;
  }

  private spawnDuplic(stepIndex: number): void {
    const anchor = calculateAnchor(DUPLIC_MANIFEST);

    // AS: t = random(50) + 10 -> scale 10-59%
    const t = Math.floor(Math.random() * 50) + 10;
    const asScale = t / 100;

    // AS: _rotation = random(360)
    const rotationDeg = Math.floor(Math.random() * 360);

    // AS: _X = _parent.c * _parent.ix; _Y = _parent.c * _parent.iy
    const x = stepIndex * this.ix;
    const y = stepIndex * this.iy;

    const anim = new FrameAnimatedSprite({
      textures: this.duplicTextures,
      fps: 40,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: asScale,
    });

    anim.sprite.rotation = (rotationDeg * Math.PI) / 180;
    anim.sprite.position.set(x, y);

    // AS duplic frame_34 (0-indexed: 33): removeMovieClip / stop
    anim.stopAt(33);

    this.container.addChild(anim.sprite);
    this.duplicAnims.push(anim);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all existing duplic animations
    for (const anim of this.duplicAnims) {
      anim.update(deltaTime);
    }

    if (!this.spawnDone) {
      // Accumulate time and spawn one pair of duplics per frame
      this.frameAccumulator += deltaTime;

      while (this.frameAccumulator >= this.frameTime && !this.spawnDone) {
        this.frameAccumulator -= this.frameTime;

        if (this.c < this.inte) {
          // AS: attachMovie("duplic","duplic"+c, c) and attachMovie("duplic","duplic"+c, c+100)
          // Two independent instances per step
          this.spawnDuplic(this.c);
          this.spawnDuplic(this.c);
          this.c++;
        } else {
          // AS: if(lok != 1) { this.end(); lok = 1; }
          if (!this.lok) {
            this.signalHit();
            this.lok = true;
          }
          this.spawnDone = true;
        }
      }
    } else {
      // AS: if(t2++ == 20) { _parent.removeMovieClip(); }
      // After spawn done, count up using frame accumulator
      this.frameAccumulator += deltaTime;

      while (this.frameAccumulator >= this.frameTime) {
        this.frameAccumulator -= this.frameTime;

        if (this.t2 === 20) {
          this.complete();
          return;
        }

        this.t2++;
      }
    }
  }

  destroy(): void {
    for (const anim of this.duplicAnims) {
      anim.destroy();
    }
    this.duplicAnims = [];
    super.destroy();
  }
}
