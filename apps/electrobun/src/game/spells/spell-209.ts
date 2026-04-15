/**
 * Spell 209 - Renvoi de Sort (Sadida / Earth)
 *
 * A ground-impact spell with flying stone particles.
 *
 * Components:
 * - anim1: Main composite animation at target position, stops at frame 171
 * - Stone particles: Groups of 5 "pierres" spawned at frames 54, 63 (x5), 69, 75
 *
 * Original AS timing:
 * - Frame 49 (0-indexed: 48): Play sound 'grrr1'
 * - Frame 55 (0-indexed: 54): Spawn 1 group of 5 stones
 * - Frame 64 (0-indexed: 63): Play sound 'grrr2', spawn 5 groups of 5 stones
 * - Frame 70 (0-indexed: 69): Spawn 1 group of 5 stones
 * - Frame 76 (0-indexed: 75): Spawn 1 group of 5 stones
 * - Frame 124 (0-indexed: 123): Signal hit (this.end())
 * - Frame 148 (0-indexed: 147): Begin fade (_alpha -= 10 per frame)
 * - Frame 172 (0-indexed: 171): removeMovieClip() / stop()
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container, Sprite, Texture } from "pixi.js";

const ANIM1_MANIFEST: SpriteManifest = {
  width: 84.8,
  height: 82.8,
  offsetX: -44.7,
  offsetY: -39.85,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 4.75,
  height: 2.3,
  offsetX: -2.4,
  offsetY: -1.7,
};

interface StoneParticle {
  sprite: Sprite;
  /** Group container position (moves via vx/vy) */
  groupX: number;
  groupY: number;
  /** Stone-local Y position (vertical bounce) */
  localY: number;
  /** Group horizontal velocity */
  vx: number;
  vy: number;
  /** Vertical velocity (gravity-affected) */
  v: number;
  /** Rotation velocity */
  vr: number;
  /** Scale as percentage */
  t: number;
  /** Alpha (0-100) */
  alpha: number;
  /** Rotation in degrees */
  rotation: number;
}

export class Spell209 extends BaseSpell {
  readonly spellId = 209;

  private mainAnim!: FrameAnimatedSprite;
  private stonesContainer!: Container;
  private stones: StoneParticle[] = [];
  private pierresAnchorX = 0.5;
  private pierresAnchorY = 0.5;
  private pierresTexture: Texture = Texture.EMPTY;

  /** Fade state after frame 147 */
  private fading = false;
  private fadeAlpha = 100;

  /** Accumulated time for physics stepping */
  private physicsAccum = 0;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Calculate anchor for pierres sprite
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);
    this.pierresAnchorX = pierresAnchor.x;
    this.pierresAnchorY = pierresAnchor.y;

    // Load pierres texture
    const pierresFrames = textures.getFrames("lib_pierres");
    this.pierresTexture = pierresFrames[0] ?? Texture.EMPTY;

    // Container for stone particles, positioned at target
    this.stonesContainer = new Container();
    this.stonesContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.stonesContainer);

    // Main composite animation at target position
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
    this.container.addChild(this.mainAnim.sprite);

    // Frame 48 (0-indexed): play grrr1
    this.mainAnim.onFrame(48, () => {
      this.callbacks.playSound("grrr1");
    });

    // Frame 54 (0-indexed): spawn 1 group of 5 stones
    this.mainAnim.onFrame(54, () => {
      this.spawnStoneGroup();
    });

    // Frame 63 (0-indexed): play grrr2 + spawn 5 groups of 5 stones
    this.mainAnim.onFrame(63, () => {
      this.callbacks.playSound("grrr2");
      this.spawnStoneGroup();
      this.spawnStoneGroup();
      this.spawnStoneGroup();
      this.spawnStoneGroup();
      this.spawnStoneGroup();
    });

    // Frame 69 (0-indexed): spawn 1 group of 5 stones
    this.mainAnim.onFrame(69, () => {
      this.spawnStoneGroup();
    });

    // Frame 75 (0-indexed): spawn 1 group of 5 stones
    this.mainAnim.onFrame(75, () => {
      this.spawnStoneGroup();
    });

    // Frame 123 (0-indexed): signal hit
    this.mainAnim.onFrame(123, () => {
      this.signalHit();
    });

    // Frame 147 (0-indexed): begin fade out
    this.mainAnim.onFrame(147, () => {
      this.fading = true;
      this.fadeAlpha = 100;
    });

    // Stop at frame 171 (0-indexed)
    this.mainAnim.stopAt(171);
  }

  /**
   * Spawn a group of 5 stone particles.
   *
   * Group parent offset (AS: _parent._x/_parent._y):
   *   groupX = 20 * (Math.random() - 0.5)
   *   groupY = 10 * (Math.random() - 0.5)
   *
   * Per stone:
   *   vx = 5 * (Math.random() - 0.5)
   *   vy = 2 * (Math.random() - 0.5)
   *   t = 60 + 40 * Math.random()
   *   _alpha = 20 + random(90)   [AS random(90) = 0..89]
   *   v = -10 * Math.random() - 3
   *   vr = 40 * (-0.5 + Math.random())
   */
  private spawnStoneGroup(): void {
    const groupX = 20 * (Math.random() - 0.5);
    const groupY = 10 * (Math.random() - 0.5);

    for (let i = 0; i < 5; i++) {
      const vx = 5 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);
      const t = 60 + 40 * Math.random();
      const alpha = 20 + Math.floor(Math.random() * 90);
      const v = -10 * Math.random() - 3;
      const vr = 40 * (-0.5 + Math.random());

      const sprite = new Sprite(this.pierresTexture);
      sprite.anchor.set(this.pierresAnchorX, this.pierresAnchorY);
      sprite.scale.set(t / 100);
      sprite.alpha = alpha / 100;
      sprite.position.set(groupX, groupY);

      this.stonesContainer.addChild(sprite);

      const stone: StoneParticle = {
        sprite,
        groupX,
        groupY,
        localY: 0,
        vx,
        vy,
        v,
        vr,
        t,
        alpha,
        rotation: 0,
      };

      this.stones.push(stone);
    }
  }

  /**
   * Update stone physics for one frame step.
   *
   * AS onClipEvent(enterFrame):
   *   _parent._x += vx
   *   _parent._y += vy
   *   if (t != 1) {
   *     _Y += v
   *     _rotation += vr
   *     v += 0.5
   *     if (_Y > 0) {
   *       vx /= 2; vy /= 2
   *       _rotation = 0; _Y = 0
   *       v = -v / 4
   *       if (Math.abs(v) < 1) { vx = 0; vy = 0; t = 1; }
   *     }
   *   }
   */
  private stepStonePhysics(): void {
    for (const stone of this.stones) {
      // Move group container
      stone.groupX += stone.vx;
      stone.groupY += stone.vy;

      if (stone.t !== 1) {
        stone.localY += stone.v;
        stone.rotation += stone.vr;
        stone.v += 0.5;

        if (stone.localY > 0) {
          stone.vx /= 2;
          stone.vy /= 2;
          stone.rotation = 0;
          stone.localY = 0;
          stone.v = -stone.v / 4;

          if (Math.abs(stone.v) < 1) {
            stone.vx = 0;
            stone.vy = 0;
            stone.t = 1;
          }
        }
      }

      // Apply to sprite
      stone.sprite.position.set(stone.groupX, stone.groupY + stone.localY);
      stone.sprite.rotation = (stone.rotation * Math.PI) / 180;
      stone.sprite.scale.set(Math.max(0, stone.t / 100));
      stone.sprite.alpha = stone.alpha / 100;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Run physics at 60fps frame steps
    const frameTime = 1000 / 60;
    this.physicsAccum += deltaTime;

    while (this.physicsAccum >= frameTime) {
      this.stepStonePhysics();
      this.physicsAccum -= frameTime;
    }

    // Apply fade after frame 147 (_alpha -= 10 per frame at 60fps)
    if (this.fading) {
      const frameDelta = deltaTime / frameTime;
      this.fadeAlpha -= 10 * frameDelta;
      const clampedAlpha = Math.max(0, this.fadeAlpha) / 100;
      this.mainAnim.sprite.alpha = clampedAlpha;
      this.stonesContainer.alpha = clampedAlpha;
    }

    // Complete when main animation stops at frame 171
    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    for (const stone of this.stones) {
      stone.sprite.destroy();
    }
    this.stones = [];
    this.stonesContainer.destroy({ children: false });
    super.destroy();
  }
}
