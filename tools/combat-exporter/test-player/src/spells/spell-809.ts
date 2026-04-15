/**
 * Spell 809 - Lakam (Sadida Earth)
 *
 * A projectile spell that fires a spinning/fading shoot toward the target,
 * then spawns stone particles (pierres) at the impact point.
 *
 * Components:
 * - shoot (composite, 166 frames): Full animation at caster position
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'lakam_405'
 * - Frame 58 (DefineSprite_39): Signal hit (this.end())
 * - Frame 208 (DefineSprite_39): Complete (_parent.removeMovieClip())
 *
 * Pierres particle physics (onClipEvent load/enterFrame):
 * - Spawned at hit (frame 58): level * 3 * 2 total (2 per tick for level*3 ticks)
 * - vd = 30 + random(30)
 * - vx = 15*(Math.random()-0.5), vy = 15*(Math.random()-0.5)
 * - an = angle+PI; v2x=cos(an)*2; v2y=sin(an)*5
 * - parentX = 20*(Math.random()-0.5), parentY = 10*(Math.random()-0.5)
 * - t = 60 + 40*Math.random() (scale%)
 * - v = -10 (upward), vr = 60*(-0.5+Math.random())
 * - Phase1 (tps<vd): localY+=v; vx/=1.2; vy/=1.2; v/=1.2
 * - Phase2 (tps>vd): localY+=v2y*=1.2; parentY+=10; localX+=v2x*=1.2; alpha-=10
 * - Death: alpha < 10 -> remove
 */

import { Sprite, Container } from 'pixi.js';
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

const PIERRES_MANIFEST: SpriteManifest = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

interface PierreParticle {
  sprite: Sprite;
  parentX: number;
  parentY: number;
  localX: number;
  localY: number;
  vx: number;
  vy: number;
  v: number;
  v2x: number;
  v2y: number;
  vr: number;
  rotation: number;
  alpha: number;
  t: number;
  vd: number;
  tps: number;
  alive: boolean;
}

export class Spell809 extends BaseSpell {
  readonly spellId = 809;

  private shootAnim!: FrameAnimatedSprite;
  private pierresContainer!: Container;
  private pierreParticles: PierreParticle[] = [];
  private pierresSpawned = false;

  private level = 1;
  private angleRad = 0;
  private particleScale = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.angleRad = init.angleRad;
    this.particleScale = init.scale;

    // Play sound at frame 1 (immediately on init)
    this.callbacks.playSound('lakam_405');

    // Shoot animation (composite 166-frame sequence)
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, init.casterY);

    // AS frame 58 -> 0-indexed frame 57: signal hit and spawn particles
    this.shootAnim.onFrame(57, () => {
      this.signalHit();
      this.spawnPierres(textures, init);
    });

    // AS frame 208 -> 0-indexed frame 207: complete
    this.shootAnim.onFrame(207, () => {
      this.complete();
    });

    this.container.addChild(this.shootAnim.sprite);

    // Container for pierres at target position
    this.pierresContainer = new Container();
    this.pierresContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.pierresContainer);
  }

  private spawnPierres(textures: SpellTextureProvider, init: SpellInitContext): void {
    if (this.pierresSpawned) {
      return;
    }
    this.pierresSpawned = true;

    const pierreFrames = textures.getFrames('lib_pierres');
    if (!pierreFrames || pierreFrames.length === 0) {
      return;
    }

    const pierreAnchor = calculateAnchor(PIERRES_MANIFEST);

    // AS: c starts at 0, each enterFrame tick spawns 2 pierres while c < level*3
    // This means level*3 ticks * 2 = level*3*2 total pierres
    const totalPierres = this.level * 3 * 2;

    // an = angle + PI (reverse direction: stones fly away from caster direction)
    const an = this.angleRad + Math.PI;
    const cosAn = Math.cos(an);
    const sinAn = Math.sin(an);

    for (let i = 0; i < totalPierres; i++) {
      // AS onClipEvent(load):
      const vd = 30 + Math.floor(Math.random() * 30);
      const vx = 15 * (Math.random() - 0.5);
      const vy = 15 * (Math.random() - 0.5);
      // v2x = Math.cos(an) * 2; v2y = Math.sin(an) * 5
      const v2x = cosAn * 2;
      const v2y = sinAn * 5;
      // _parent._x = 20*(Math.random()-0.5); _parent._y = 10*(Math.random()-0.5)
      const parentX = 20 * (Math.random() - 0.5);
      const parentY = 10 * (Math.random() - 0.5);
      // t = 60 + 40*Math.random()
      const t = 60 + 40 * Math.random();
      // v = -10 (upward lift)
      const v = -10;
      // vr = 60 * (-0.5 + Math.random())
      const vr = 60 * (-0.5 + Math.random());
      // Initial rotation: DefineSprite_3 frame_1: _rotation = random(360)
      const rotation = Math.floor(Math.random() * 360);
      // Initial frame: gotoAndPlay(random(4) + 1) -> 0-indexed: random(4)
      const startFrameIdx = Math.floor(Math.random() * 4);

      // Pick texture frame (use startFrameIdx mod length)
      const texIdx = startFrameIdx % pierreFrames.length;
      const spr = new Sprite(pierreFrames[texIdx]);
      spr.anchor.set(pierreAnchor.x, pierreAnchor.y);
      spr.scale.set((t / 100) * init.scale);
      spr.rotation = (rotation * Math.PI) / 180;
      spr.alpha = 1;
      spr.position.set(parentX, parentY);

      this.pierresContainer.addChild(spr);

      const particle: PierreParticle = {
        sprite: spr,
        parentX,
        parentY,
        localX: 0,
        localY: 0,
        vx,
        vy,
        v,
        v2x,
        v2y,
        vr,
        rotation,
        alpha: 100,
        t,
        vd,
        tps: 0,
        alive: true,
      };

      this.pierreParticles.push(particle);
    }
  }

  private updatePierres(): void {
    for (const p of this.pierreParticles) {
      if (!p.alive) {
        continue;
      }

      // AS: if (_alpha < 10) removeMovieClip(_parent)
      if (p.alpha < 10) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }

      // _parent._x += vx; _parent._y += vy
      p.parentX += p.vx;
      p.parentY += p.vy;

      // _rotation = _rotation + vr
      p.rotation += p.vr;

      // Phase 1: if (tps++ < vd) — post-increment: check then increment
      if (p.tps < p.vd) {
        p.localY += p.v;
        p.vx /= 1.2;
        p.vy /= 1.2;
        p.v /= 1.2;
      }
      p.tps++;

      // Phase 2: if (tps++ > vd) — AS increments tps a second time here
      if (p.tps > p.vd) {
        p.v2y *= 1.2;
        p.localY += p.v2y;
        p.parentY += 10;
        p.v2x *= 1.2;
        p.localX += p.v2x;
        p.alpha -= 10;
      }
      p.tps++;

      // Apply state to sprite
      const worldX = p.parentX + p.localX;
      const worldY = p.parentY + p.localY;
      p.sprite.position.set(worldX, worldY);
      p.sprite.rotation = (p.rotation * Math.PI) / 180;
      p.sprite.scale.set((p.t / 100) * this.particleScale);
      p.sprite.alpha = Math.max(0, p.alpha / 100);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updatePierres();

    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    for (const p of this.pierreParticles) {
      p.sprite.destroy();
    }
    this.pierreParticles = [];
    super.destroy();
  }
}
