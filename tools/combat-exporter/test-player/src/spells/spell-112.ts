/**
 * Spell 112 - Flèche Naturelle (Natural Arrow)
 *
 * A projectile spell with a beam traveling from caster to target,
 * then an impact with bubble particles.
 *
 * Components:
 * - sprite_4: Caster animation at caster position, stops at frame 51
 * - sprite_9: Beam/arrow (child of sprite_10), rotated to angle, stops at frame 24
 * - sprite_10: Main projectile container, positioned at caster, travels to target
 * - sprite_11: Impact animation at target position, spawns bubble particles at frame 69
 *
 * Original AS timing:
 * - Frame 0 (sprite_10 / DefineSprite_10 frame_1): Play sound 'herbe', set position/angle
 * - Frame 1 (main / frame_2): Play sound 'jet_903', stop main timeline
 * - Frame 24 (sprite_9 / DefineSprite_9 frame_25): stop()
 * - Frame 45 (sprite_10 / DefineSprite_10 frame_46): stop()
 * - Frame 69 (sprite_11 / DefineSprite_11 frame_70): Play 'coquille', spawn 6 bubbles, signal hit
 * - Frame 132 (sprite_11 / DefineSprite_11 frame_133): removeMovieClip() - animation ends
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_4_MANIFEST: SpriteManifest = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

const SPRITE_9_MANIFEST: SpriteManifest = {
  width: 227.85,
  height: 48.85,
  offsetX: -48.55,
  offsetY: -24.75,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 227.85,
  height: 131.15,
  offsetX: -49.55,
  offsetY: -123,
};

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 250.55,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

const BULLE_MANIFEST: SpriteManifest = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

export class Spell112 extends BaseSpell {
  readonly spellId = 112;

  private sprite4Anim!: FrameAnimatedSprite;
  private sprite9Anim!: FrameAnimatedSprite;
  private sprite10Anim!: FrameAnimatedSprite;
  private sprite11Anim!: FrameAnimatedSprite;

  private sprite10Container!: Container;
  private bubbleParticles!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // ---- sprite_4: Caster animation ----
    // Positioned at caster (origin), stops at frame 51 (AS frame 52)
    const sprite4Anchor = calculateAnchor(SPRITE_4_MANIFEST);
    this.sprite4Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_4'),
      anchorX: sprite4Anchor.x,
      anchorY: sprite4Anchor.y,
      scale: init.scale,
    }));
    this.sprite4Anim.stopAt(51);
    this.sprite4Anim.sprite.position.set(0, init.casterY);
    this.container.addChild(this.sprite4Anim.sprite);

    // ---- sprite_10: Projectile container ----
    // AS: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 80;
    // Since our container is already at cellFrom, we position relative to that.
    // _Y = cellFrom.y - 80 => relative to cellFrom.y: y = -80
    // sprite_10 stops at frame 45 (AS frame 46)
    const sprite10Anchor = calculateAnchor(SPRITE_10_MANIFEST);
    this.sprite10Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      scale: init.scale,
    }));
    this.sprite10Anim.stopAt(45);
    this.sprite10Anim.sprite.position.set(0, -80);
    // Play 'herbe' at frame 0 (AS frame 1)
    this.sprite10Anim.onFrame(0, () => this.callbacks.playSound('herbe'));
    this.container.addChild(this.sprite10Anim.sprite);

    // ---- sprite_9: Beam/arrow inside sprite_10's coordinate space ----
    // AS: onClipEvent(load) { _rotation = _parent.angle; }
    // We compute the angle the same way AS does:
    // dx = cellTo.x - cellFrom.x
    // dy = cellTo.y + 10 - cellFrom.y + 80
    // angle = atan2(dy, dx) * 180 / pi
    let dx = 0;
    let dy = 0;
    if (context?.cellFrom && context?.cellTo) {
      dx = context.cellTo.x - context.cellFrom.x;
      dy = context.cellTo.y + 10 - context.cellFrom.y + 80;
    }
    const angle = Math.atan2(dy, dx);

    const sprite9Anchor = calculateAnchor(SPRITE_9_MANIFEST);
    this.sprite9Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      scale: init.scale,
    }));
    this.sprite9Anim.stopAt(24);
    this.sprite9Anim.sprite.rotation = angle;
    // sprite_9 is a child of sprite_10's sprite
    this.sprite10Anim.sprite.addChild(this.sprite9Anim.sprite);

    // ---- sprite_11: Impact animation at target position ----
    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 10; _rotation = _parent.angle;
    // Relative to our container (cellFrom):
    // x = cellTo.x - cellFrom.x = targetX
    // y = cellTo.y - 10 - cellFrom.y = (cellTo.y - cellFrom.y) - 10
    let impactX = 0;
    let impactY = -10;
    if (context?.cellFrom && context?.cellTo) {
      impactX = context.cellTo.x - context.cellFrom.x;
      impactY = context.cellTo.y - context.cellFrom.y - 10;
    }

    const sprite11Anchor = calculateAnchor(SPRITE_11_MANIFEST);
    this.sprite11Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_11'),
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      scale: init.scale,
    }));
    this.sprite11Anim.sprite.position.set(impactX, impactY);
    this.sprite11Anim.sprite.rotation = init.angleRad;

    // Frame 69 (AS frame 70): play sound, spawn bubbles, signal hit
    this.sprite11Anim.onFrame(69, () => {
      this.callbacks.playSound('coquille');
      this.spawnBubbles(impactX, impactY);
      this.signalHit();
    });

    // Frame 132 (AS frame 133): removeMovieClip -> complete
    this.sprite11Anim.onFrame(132, () => {
      this.complete();
    });

    this.container.addChild(this.sprite11Anim.sprite);

    // ---- Bubble particle system ----
    // Bubbles are spawned at the impact point; no container offset needed beyond that
    const bulleTextures = textures.getFrames('lib_bulle');
    const bulleTexture = bulleTextures[0];
    this.bubbleParticles = new ASParticleSystem(bulleTexture);
    this.bubbleParticles.container.position.set(impactX, impactY);
    this.container.addChild(this.bubbleParticles.container);

    // Play main timeline sound (frame_2 / AS frame 2 = 0-indexed frame 1)
    // The main timeline stops at frame 2 and plays 'jet_903'
    // We simulate this by playing it immediately (it's the start sound)
    this.callbacks.playSound('jet_903');
  }

  private spawnBubbles(impactX: number, impactY: number): void {
    // AS: c = 1; while(c < 7) { attachMovie("bulle", "bulle" + c, c); c++; }
    // Spawns 6 bubbles (c = 1..6)
    const bulleAnchor = calculateAnchor(BULLE_MANIFEST);
    const bulleTextures = this.bubbleParticles['texture'] ? [] : [];

    // The bubbles each have their own physics from DefineSprite_5_bulle/frame_1/DoAction.as:
    // rx = 0.7 + 0.15 * Math.random()
    // ry = 0.8 + 0.15 * Math.random()
    // vx = 20 + random(25)
    // vy = -15 + random(30)
    // _alpha = random(50) + 50
    // onEnterFrame: _X += (vx *= rx); _Y += (vy *= ry);
    //
    // Also, each bulle's inner sprite_4 does: gotoAndPlay(random(5) + 1)
    // which just randomizes starting frame of its inner animation.
    //
    // The bulle physics use accX=rx, accY=ry as velocity multipliers (friction).
    // There is no vtDecay/scale change - bubbles just move until off-screen.
    // We model them with t=100 (full scale), vt=0 (no scale change).

    this.bubbleParticles.spawnMany(6, () => {
      const rx = 0.7 + 0.15 * Math.random();
      const ry = 0.8 + 0.15 * Math.random();
      const vx = 20 + Math.floor(Math.random() * 25);
      const vy = -15 + Math.floor(Math.random() * 30);
      const alpha = (Math.floor(Math.random() * 50) + 50) / 100;

      return {
        x: 0,
        y: 0,
        vx,
        vy,
        accX: rx,
        accY: ry,
        vr: 0,
        vrDecay: 1,
        t: 100,
        vt: 0,
        vtDecay: 0,
        alpha,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.bubbleParticles.update();

    // Completion is triggered by sprite_11's frame 132 callback
  }

  destroy(): void {
    this.bubbleParticles.destroy();
    super.destroy();
  }
}
