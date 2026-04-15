/**
 * Spell 408 - Lakam (Earth/Rock throw)
 *
 * A rock-throwing spell that spawns stone particles that fly toward the target.
 *
 * Components:
 * - shoot: Main animation at target position, 83 frames
 * - Particles (pierres): Stone particles spawned progressively, flying toward caster
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'lakam_405'
 * - Frame 2 (DefineSprite_14): stop() + this.end() → signal hit
 * - Frame 83 (shoot): removeMovieClip() → animation ends
 * - enterFrame (DefineSprite_11): spawn pairs of 'pierres' up to level * 3 total
 * - Each pierre: flies with randomized velocity, bounces toward caster direction, fades out
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 126.25,
  height: 122.8,
  offsetX: -61.6,
  offsetY: -103.15,
};

const PIERRE_MANIFEST: SpriteManifest = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

interface PierreParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  v2x: number;
  v2y: number;
  v: number;
  vr: number;
  tps: number;
  vd: number;
  alpha: number;
  alive: boolean;
  rotation: number;
  anim: FrameAnimatedSprite;
  parentX: number;
  parentY: number;
}

export class Spell408 extends BaseSpell {
  readonly spellId = 408;

  private shootAnim!: FrameAnimatedSprite;
  private pierreContainer!: Container;
  private pierres: PierreParticle[] = [];
  private pierreTextures: Texture[] = [];
  private maxPierres = 0;
  private spawnedCount = 0;
  private pierreScale = 1;
  private angleForPierres = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    const level = Math.max(1, Math.min(6, context?.level ?? 1));
    // DefineSprite_11 enterFrame: while c < level*3, c+=1, attach, c+=1, attach
    // → spawns level*3 total particles
    this.maxPierres = level * 3;
    this.pierreScale = init.scale;
    this.angleForPierres = context?.angle ?? 0;

    this.pierreTextures = textures.getFrames('lib_pierres');

    // Container for pierres, positioned at target
    this.pierreContainer = new Container();
    this.pierreContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.pierreContainer);

    // Shoot animation at target position
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 25,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): play sound
    this.shootAnim.onFrame(0, () => this.callbacks.playSound('lakam_405'));

    // Frame 2 (0-indexed: 1): signal hit (DefineSprite_14 frame_2: stop() + this.end())
    this.shootAnim.onFrame(1, () => this.signalHit());

    this.container.addChild(this.shootAnim.sprite);
  }

  private spawnPierre(): void {
    if (this.spawnedCount >= this.maxPierres) {
      return;
    }

    const pierreTex = this.pierreTextures[0];
    if (!pierreTex) {
      return;
    }

    const pierreAnchor = calculateAnchor(PIERRE_MANIFEST);

    const anim = new FrameAnimatedSprite({
      textures: this.pierreTextures,
      fps: 25,
      anchorX: pierreAnchor.x,
      anchorY: pierreAnchor.y,
      scale: this.pierreScale,
    });

    // DefineSprite_8 frame_1: _rotation = random(360)
    anim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

    // onClipEvent(load):
    const vd = 30 + Math.floor(Math.random() * 30);
    const vx = 15 * (Math.random() - 0.5);
    const vy = 15 * (Math.random() - 0.5);
    // an = angle + PI (reverse direction - fly back toward caster)
    const an = (this.angleForPierres * Math.PI) / 180 + Math.PI;
    const v2x = Math.cos(an) * 5;
    const v2y = Math.sin(an) * 5;
    const parentX = 20 * (Math.random() - 0.5);
    const parentY = 10 * (Math.random() - 0.5);
    const t = 60 + 40 * Math.random();
    const v = -10;
    const vr = 60 * (-0.5 + Math.random());

    // t is xscale/yscale percentage — apply as additional scale factor
    anim.sprite.scale.set(this.pierreScale * (t / 100));
    anim.sprite.position.set(parentX, parentY);

    this.pierreContainer.addChild(anim.sprite);

    const particle: PierreParticle = {
      x: 0,
      y: 0,
      vx,
      vy,
      v2x,
      v2y,
      v,
      vr,
      tps: 0,
      vd,
      alpha: 1,
      alive: true,
      rotation: anim.sprite.rotation * (180 / Math.PI),
      anim,
      parentX,
      parentY,
    };

    this.pierres.push(particle);
    this.spawnedCount++;
  }

  private updatePierres(): void {
    for (const p of this.pierres) {
      if (!p.alive) {
        continue;
      }

      // if(_alpha < 10) removeMovieClip(_parent)
      // _alpha in AS is 0-100, we store as 0-1
      if (p.alpha * 100 < 10) {
        p.alive = false;
        p.anim.sprite.visible = false;
        continue;
      }

      // _parent._x += vx; _parent._y += vy
      p.parentX += p.vx;
      p.parentY += p.vy;

      // _rotation = _rotation + vr
      p.rotation += p.vr;
      p.anim.sprite.rotation = (p.rotation * Math.PI) / 180;

      // if(tps++ < vd) — post-increment: compare then increment
      if (p.tps < p.vd) {
        p.y += p.v;
        p.vx /= 1.2;
        p.vy /= 1.2;
        p.v /= 1.2;
      }
      p.tps++;

      // if(tps++ > vd) — another post-increment check
      if (p.tps > p.vd) {
        p.y += (p.v2y *= 1.2);
        p.x += (p.v2x *= 1.2);
        // _alpha -= 10 (AS: 0-100 scale → 0.1 in 0-1 scale)
        p.alpha -= 0.1;
      }
      p.tps++;

      // Apply to sprite
      p.anim.sprite.position.set(p.parentX + p.x, p.parentY + p.y);
      p.anim.sprite.alpha = Math.max(0, p.alpha);

      p.anim.update(1000 / 25);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update main shoot animation
    this.anims.update(deltaTime);

    // Spawn pierre particles progressively (2 per frame while count < maxPierres)
    if (this.spawnedCount < this.maxPierres) {
      this.spawnPierre();
      this.spawnPierre();
    }

    // Update pierre particles
    this.updatePierres();

    // Complete when shoot animation is done and no alive pierres remain
    if (this.shootAnim.isComplete()) {
      const anyAlive = this.pierres.some(p => p.alive);
      if (!anyAlive) {
        this.complete();
      }
    }
  }

  destroy(): void {
    for (const p of this.pierres) {
      p.anim.destroy();
    }
    this.pierres = [];
    super.destroy();
  }
}
