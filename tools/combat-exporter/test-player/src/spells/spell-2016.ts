/**
 * Spell 2016 - Setag (Osamodas)
 *
 * A projectile/shoot spell with trailing "cercle" particles.
 *
 * Components:
 * - shoot: Main animation (159 frames) at caster position
 *   - Frame 0: Play sound 'setag_305'
 *   - Frame 129 (AS 130): Sub-sprite starts alpha fade (-10/frame), signal hit
 *   - Frame 156 (AS 157): removeMovieClip + stop → complete()
 * - move element: Interpolates from caster to target, spawning cercle particles each frame
 * - cercle particles (lib_cercle): Trailing particles with velocity decay and alpha fade
 *
 * Original AS timing:
 * - frame_1/DoAction.as: SOMA.playSound("setag_305")
 * - DefineSprite_6_shoot frame 130: sub-sprite fades _alpha -= 10 per frame
 * - DefineSprite_6_shoot frame 157: _parent.removeMovieClip(); stop()
 * - DefineSprite_11_move frame_1: each enterFrame spawns a cercle at current pos with velocity = delta pos
 * - DefineSprite_18_cercle load: va=2-random(1.5), t=60+random(70), alpha=70+random(30), r=1.05+0.5*Math.random()
 * - DefineSprite_18_cercle enterFrame: alpha-=va; x+=vx; y+=vy; vx/=r; vy/=r; if alpha<10 remove
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 90.15,
  height: 62.85,
  offsetX: -25,
  offsetY: -60.75,
};

const CERCLE_MANIFEST: SpriteManifest = {
  width: 24.75,
  height: 10.45,
  offsetX: -11.15,
  offsetY: -9.5,
};

interface CercleParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  va: number;
  r: number;
  sprite: Sprite;
  alive: boolean;
}

export class Spell2016 extends BaseSpell {
  readonly spellId = 2016;

  private shootAnim!: FrameAnimatedSprite;
  private cercleContainer!: Container;
  private cercleParticles: CercleParticle[] = [];
  private cercleTexture: Texture = Texture.EMPTY;

  // "move" element tracking
  private prevMoveX = 0;
  private prevMoveY = 0;
  private lastSpawnedFrame = -1;

  // Target position (relative to cercleContainer)
  private moveEndX = 0;
  private moveEndY = 0;

  // Sub-sprite alpha fade state (starts at frame 129)
  private subSpriteAlpha = 100;
  private subSpriteFading = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Store cercle texture for particle spawning
    const cercleFrames = textures.getFrames('lib_cercle');
    this.cercleTexture = cercleFrames[0] ?? Texture.EMPTY;

    // Main shoot animation at caster position
    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);

    // Frame 0 (AS frame 1): play sound
    this.shootAnim.onFrame(0, () => this.callbacks.playSound('setag_305'));

    // Frame 129 (AS frame 130): start alpha fade of sub-sprite + signal hit
    this.shootAnim.onFrame(129, () => {
      this.subSpriteFading = true;
      this.signalHit();
    });

    // Frame 156 (AS frame 157): animation ends
    this.shootAnim.onFrame(156, () => {
      this.complete();
    });

    this.container.addChild(this.shootAnim.sprite);

    // Container for cercle particles, positioned at caster
    this.cercleContainer = new Container();
    this.cercleContainer.position.set(0, init.casterY);
    this.container.addChild(this.cercleContainer);

    // The "move" element travels from (0, 0) relative to cercleContainer to target
    // init.targetY already includes Y_OFFSET, init.casterY = Y_OFFSET, so relative = targetY - casterY
    this.moveEndX = init.targetX;
    this.moveEndY = init.targetY - init.casterY;

    this.prevMoveX = 0;
    this.prevMoveY = 0;
    this.lastSpawnedFrame = -1;
  }

  /**
   * Interpolate "move" element position from caster to target over 129 frames.
   * After frame 129 it stays at target.
   */
  private getMovePosition(frame: number): { x: number; y: number } {
    const travelFrames = 129;
    const t = Math.min(frame / travelFrames, 1);
    return {
      x: this.moveEndX * t,
      y: this.moveEndY * t,
    };
  }

  /**
   * Spawn a cercle particle.
   * AS: DefineSprite_11_move spawns at _X, _Y - 20 with velocity = delta pos
   * AS: DefineSprite_18_cercle onClipEvent(load):
   *   va = 2 - random(1.5)
   *   t = 60 + random(70)
   *   _xscale = t; _yscale = t
   *   _alpha = 70 + random(30)
   *   r = 1.05 + 0.5 * Math.random()
   */
  private spawnCercle(x: number, y: number, vx: number, vy: number): void {
    const sprite = new Sprite(this.cercleTexture);
    const anchor = calculateAnchor(CERCLE_MANIFEST);
    sprite.anchor.set(anchor.x, anchor.y);

    // AS: va = 2 - random(1.5)
    // In AS2, random() truncates its argument to integer: random(1) always returns 0
    // Replicating exactly: Math.floor(Math.random() * 1.5) can be 0 or 1
    const va = 2 - Math.floor(Math.random() * 1.5);

    // AS: t = 60 + random(70)
    const t = 60 + Math.floor(Math.random() * 70);

    // AS: _xscale = t; _yscale = t (percentage → 0-1)
    sprite.scale.set(t / 100);

    // AS: _alpha = 70 + random(30) (percentage → 0-1)
    const alphaInit = 70 + Math.floor(Math.random() * 30);
    sprite.alpha = alphaInit / 100;

    // AS: r = 1.05 + 0.5 * Math.random()
    const r = 1.05 + 0.5 * Math.random();

    sprite.position.set(x, y);

    this.cercleContainer.addChild(sprite);

    this.cercleParticles.push({
      x,
      y,
      vx,
      vy,
      alpha: alphaInit,
      va,
      r,
      sprite,
      alive: true,
    });
  }

  /**
   * Update all cercle particles per AS enterFrame logic:
   *   if(_alpha < 10) { _parent.removeMovieClip(); }
   *   _alpha = _alpha - va;
   *   _X = _X + _parent.vx;
   *   _Y = _Y + _parent.vy;
   *   _parent.vx /= r;
   *   _parent.vy /= r;
   */
  private updateCercles(): void {
    for (const p of this.cercleParticles) {
      if (!p.alive) {
        continue;
      }

      if (p.alpha < 10) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }

      p.alpha -= p.va;
      p.x += p.vx;
      p.y += p.vy;
      p.vx /= p.r;
      p.vy /= p.r;

      p.sprite.position.set(p.x, p.y);
      p.sprite.alpha = Math.max(0, p.alpha / 100);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updateCercles();

    // Spawn cercle particles for each new frame the shoot animation advances through
    const currentFrame = this.shootAnim.getFrame();

    if (currentFrame !== this.lastSpawnedFrame) {
      const currentPos = this.getMovePosition(currentFrame);
      const vx = currentPos.x - this.prevMoveX;
      const vy = currentPos.y - this.prevMoveY;

      // AS: _parent.attachMovie("cercle",...); eval(...)._x = _X; eval(...)._y = _Y - 20;
      this.spawnCercle(currentPos.x, currentPos.y - 20, vx, vy);

      this.prevMoveX = currentPos.x;
      this.prevMoveY = currentPos.y;
      this.lastSpawnedFrame = currentFrame;
    }

    // Handle sub-sprite alpha fade starting at frame 129 (AS: _parent._alpha -= 10)
    if (this.subSpriteFading) {
      this.subSpriteAlpha = Math.max(0, this.subSpriteAlpha - 10);
      this.shootAnim.sprite.alpha = this.subSpriteAlpha / 100;
    }
  }

  destroy(): void {
    for (const p of this.cercleParticles) {
      p.sprite.destroy();
    }
    this.cercleParticles = [];
    super.destroy();
  }
}
