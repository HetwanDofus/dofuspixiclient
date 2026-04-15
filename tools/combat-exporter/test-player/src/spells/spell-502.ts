/**
 * Spell 502 - Many (Earth spell)
 *
 * A composite animation with 20 particle "pierres" (stones) that bounce
 * with physics, plus a main animation.
 *
 * Components:
 * - anim1: Main composite animation at target position, stops at frame 72
 *   - Contains a sub-sprite (DefineSprite_9) that spawns 20 stone particles
 *   - Stones have bouncing physics with gravity
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'many_502'
 * - Frame 49 (DefineSprite_12): Signal hit (this.end())
 * - Frame 73 (DefineSprite_12): removeMovieClip() - animation ends
 *
 * Stone physics (pierres):
 * - vx = 5 * (Math.random() - 0.5)
 * - vy = 2 * (Math.random() - 0.5)
 * - x = 20 * (Math.random() - 0.5)
 * - y = 10 * (Math.random() - 0.5)
 * - t = 60 + 40 * Math.random() (scale percentage)
 * - alpha = 20 + random(90)
 * - v = -15 * Math.random() - 5 (vertical velocity)
 * - vr = 40 * (-0.5 + Math.random()) (rotation velocity)
 * - Bounces when _Y > 0, gravity = 1.5 per frame
 */

import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';
import { Container, Sprite, Texture } from 'pixi.js';

const ANIM1_MANIFEST: SpriteManifest = {
  width: 173.9,
  height: 161.55,
  offsetX: -86.95,
  offsetY: -117.45,
};

interface StoneParticle {
  sprite: Sprite;
  /** Parent container x/y (moves with vx/vy) */
  parentX: number;
  parentY: number;
  /** Local Y within parent (for bounce physics) */
  localY: number;
  vx: number;
  vy: number;
  v: number;
  vr: number;
  rotation: number;
  /** t flag: 1 = settled (stopped bouncing) */
  t: number;
  alive: boolean;
}

export class Spell502 extends BaseSpell {
  readonly spellId = 502;

  private mainAnim!: FrameAnimatedSprite;
  private stonesContainer!: Container;
  private stones: StoneParticle[] = [];
  private stoneTexture: Texture = Texture.EMPTY;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation (anim1) at target position
    const anim1Textures = textures.getFrames('anim1');
    const anchor = calculateAnchor(ANIM1_MANIFEST);

    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: anim1Textures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));

    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): Play sound
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('many_502'));

    // Frame 48 (AS frame 49): Signal hit
    this.mainAnim.onFrame(48, () => this.signalHit());

    // Stop at frame 72 (AS frame 73 triggers removeMovieClip, so stop at 72 = index 72)
    this.mainAnim.stopAt(72);

    this.container.addChild(this.mainAnim.sprite);

    // Stone particles container - positioned at target (same as the DefineSprite_9 which
    // is placed within the main anim at the same location)
    this.stonesContainer = new Container();
    this.stonesContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.stonesContainer);

    // Get stone texture from library symbol
    const pierresFrames = textures.getFrames('lib_pierres');
    this.stoneTexture = (pierresFrames && pierresFrames.length > 0) ? pierresFrames[0] : Texture.EMPTY;

    // Spawn 20 stone particles (AS: c = 0; while(c < 20))
    for (let c = 0; c < 20; c++) {
      this.spawnStone();
    }
  }

  private spawnStone(): void {
    const sprite = new Sprite(this.stoneTexture);
    sprite.anchor.set(0.5);

    // AS: vx = 5 * (Math.random() - 0.5)
    const vx = 5 * (Math.random() - 0.5);
    // AS: vy = 2 * (Math.random() - 0.5)
    const vy = 2 * (Math.random() - 0.5);
    // AS: _parent._x = 20 * (Math.random() - 0.5)
    const parentX = 20 * (Math.random() - 0.5);
    // AS: _parent._y = 10 * (Math.random() - 0.5)
    const parentY = 10 * (Math.random() - 0.5);
    // AS: t = 60 + 40 * Math.random()
    const t = 60 + 40 * Math.random();
    // AS: _xscale = t; _yscale = t
    sprite.scale.set(t / 100);
    // AS: _alpha = 20 + random(90)
    sprite.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
    // AS: v = -15 * Math.random() - 5
    const v = -15 * Math.random() - 5;
    // AS: vr = 40 * (-0.5 + Math.random())
    const vr = 40 * (-0.5 + Math.random());

    // localY starts at 0 (the _Y of the inner sprite)
    const localY = 0;

    sprite.position.set(parentX, parentY + localY);
    sprite.rotation = 0;

    this.stonesContainer.addChild(sprite);

    this.stones.push({
      sprite,
      parentX,
      parentY,
      localY,
      vx,
      vy,
      v,
      vr,
      rotation: 0,
      t,
      alive: true,
    });
  }

  private updateStones(): void {
    for (const stone of this.stones) {
      if (!stone.alive) {
        continue;
      }

      // AS: _parent._x += vx; _parent._y += vy;
      stone.parentX += stone.vx;
      stone.parentY += stone.vy;

      if (stone.t !== 1) {
        // AS: _Y = _Y + v
        stone.localY += stone.v;
        // AS: _rotation = _rotation + vr
        stone.rotation += stone.vr;
        // AS: v += 1.5
        stone.v += 1.5;

        if (stone.localY > 0) {
          // AS: vx /= 2; vy /= 2
          stone.vx /= 2;
          stone.vy /= 2;
          // AS: _rotation = 0
          stone.rotation = 0;
          // AS: _Y = 0
          stone.localY = 0;
          // AS: v = (-v) / 4
          stone.v = (-stone.v) / 4;

          if (Math.abs(stone.v) < 1) {
            stone.vx = 0;
            stone.vy = 0;
            stone.t = 1;
          }
        }
      }

      // Apply to sprite: parent position + local Y
      stone.sprite.position.set(stone.parentX, stone.parentY + stone.localY);
      stone.sprite.rotation = (stone.rotation * Math.PI) / 180;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updateStones();

    // Complete when main animation is stopped (reached frame 72)
    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    // Clean up stone sprites
    for (const stone of this.stones) {
      stone.sprite.destroy();
    }
    this.stones = [];

    if (this.stonesContainer) {
      this.stonesContainer.destroy({ children: false });
    }

    super.destroy();
  }
}
