/**
 * Spell 616 - Dodge (Sram)
 *
 * A dodge/evasion spell with caster and target effects.
 *
 * Components:
 * - sprite_20: Caster effect at cellFrom position, plays sound at frame 0
 * - sprite_33: Target effect at cellTo position, plays sound at frame 63, signals hit at frame 96, stops at frame 180
 * - sprite_32: Multiple instances within sprite_33, random rotation/scale/startFrame, stop at 135
 * - sprite_25: Spark instances within sprite_33, random rotation/scale, stop at 12
 * - sprite_19: Background loop within sprite_33, random start, stop at 60
 * - sprite_8: Part of caster effect, stop at 63
 * - sprite_7: Rotating spark instances, random rotation/alpha/startFrame, stop at 45
 * - sprite_29: Static spark frame (random stop)
 * - sprite_30/31: Particle-like floating elements
 *
 * Original AS timing:
 * - DefineSprite_20/frame_1: Play sound 'dodge_616a', position at cellFrom
 * - DefineSprite_20/frame_103: stop()
 * - DefineSprite_33/frame_1: Position at cellTo
 * - DefineSprite_33/frame_64: Play sound 'dodge_616b'
 * - DefineSprite_33/frame_97: this.end() → signalHit
 * - DefineSprite_33/frame_181: removeMovieClip/stop → complete
 * - DefineSprite_32/frame_1: Random rotation offset, random scale, random startFrame (0-44)
 * - DefineSprite_32/frame_136: stop()
 * - DefineSprite_25/frame_1: Random rotation, random scale (30-79%)
 * - DefineSprite_25/frame_13: stop()
 * - DefineSprite_19/frame_1: gotoAndPlay(random(10)) → startFrame 0-9
 * - DefineSprite_19/frame_61: stop()
 * - DefineSprite_7/frame_1: Random rotation, random startFrame (24+random(6)), random alpha (40-99)
 * - DefineSprite_7/frame_46: stop()
 * - DefineSprite_8/frame_64: stop()
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_7_MANIFEST: SpriteManifest = {
  width: 99,
  height: 8.1,
  offsetX: 0.3,
  offsetY: -5.15,
};

const SPRITE_8_MANIFEST: SpriteManifest = {
  width: 124.35,
  height: 52.85,
  offsetX: -14.95,
  offsetY: -35.4,
};

const SPRITE_19_MANIFEST: SpriteManifest = {
  width: 34.85,
  height: 108.05,
  offsetX: -14.35,
  offsetY: -106.6,
};

const SPRITE_20_MANIFEST: SpriteManifest = {
  width: 157.5,
  height: 191.5,
  offsetX: -109.35,
  offsetY: -182.85,
};

const SPRITE_25_MANIFEST: SpriteManifest = {
  width: 104.7,
  height: 73.7,
  offsetX: -51.15,
  offsetY: -36.65,
};

const SPRITE_32_MANIFEST: SpriteManifest = {
  width: 104.7,
  height: 157.3,
  offsetX: -48.2,
  offsetY: -34.55,
};

const SPRITE_33_MANIFEST: SpriteManifest = {
  width: 127,
  height: 187.35,
  offsetX: -62.7,
  offsetY: -159.6,
};

export class Spell616 extends BaseSpell {
  readonly spellId = 616;

  private casterContainer!: Container;
  private targetContainer!: Container;
  private mainTargetAnim!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // ---- Caster effect (sprite_20) ----
    this.casterContainer = new Container();
    this.casterContainer.position.set(0, init.casterY);
    this.container.addChild(this.casterContainer);

    const sprite20Anchor = calculateAnchor(SPRITE_20_MANIFEST);
    const sprite20Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_20'),
      anchorX: sprite20Anchor.x,
      anchorY: sprite20Anchor.y,
      scale: init.scale,
    }));
    sprite20Anim.stopAt(102);
    sprite20Anim.onFrame(0, () => this.callbacks.playSound('dodge_616a'));
    sprite20Anim.addTo(this.casterContainer);

    // sprite_8 within caster area
    const sprite8Anchor = calculateAnchor(SPRITE_8_MANIFEST);
    const sprite8Anim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_8'),
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      scale: init.scale,
    }));
    sprite8Anim.stopAt(63);
    sprite8Anim.addTo(this.casterContainer);

    // sprite_7 instances within caster area (several rotating sparks)
    // AS: _rotation = random(360), gotoAndPlay(24 + random(6)), _alpha = 40 + random(60)
    const sprite7Textures = textures.getFrames('sprite_7');
    const sprite7Anchor = calculateAnchor(SPRITE_7_MANIFEST);
    const sprite7Count = 5;
    for (let i = 0; i < sprite7Count; i++) {
      const rotation = Math.floor(Math.random() * 360);
      const startFrame = 24 + Math.floor(Math.random() * 6);
      const alpha = (40 + Math.floor(Math.random() * 60)) / 100;

      const s7Anim = this.anims.add(new FrameAnimatedSprite({
        textures: sprite7Textures,
        anchorX: sprite7Anchor.x,
        anchorY: sprite7Anchor.y,
        scale: init.scale,
        startFrame,
      }));
      s7Anim.sprite.rotation = (rotation * Math.PI) / 180;
      s7Anim.sprite.alpha = alpha;
      s7Anim.stopAt(45);
      s7Anim.addTo(this.casterContainer);
    }

    // ---- Target effect (sprite_33) ----
    this.targetContainer = new Container();
    this.targetContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.targetContainer);

    const sprite33Anchor = calculateAnchor(SPRITE_33_MANIFEST);
    this.mainTargetAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_33'),
      anchorX: sprite33Anchor.x,
      anchorY: sprite33Anchor.y,
      scale: init.scale,
    }));
    this.mainTargetAnim.stopAt(180);
    this.mainTargetAnim.onFrame(63, () => this.callbacks.playSound('dodge_616b'));
    this.mainTargetAnim.onFrame(96, () => this.signalHit());
    this.mainTargetAnim.onFrame(180, () => this.complete());
    this.mainTargetAnim.addTo(this.targetContainer);

    // sprite_32 instances within target area
    // AS: r = _rotation; _rotation = r + 40*(-0.5+Math.random()); _xscale = 50+random(50); _yscale = 80+random(60); gotoAndPlay(random(45));
    // The sprite_32 has a child (PlaceObject2_31_3) with onClipEvent(load): _rotation = random(360)
    // but from the sprite_32 frame_1 DoAction, r = _rotation means r=0 initially for main clip
    const sprite32Textures = textures.getFrames('sprite_32');
    const sprite32Anchor = calculateAnchor(SPRITE_32_MANIFEST);
    const sprite32Count = 4;
    for (let i = 0; i < sprite32Count; i++) {
      const r = 0; // initial rotation of the placed instance
      const rotOffset = 40 * (-0.5 + Math.random());
      const rotDeg = r + rotOffset;
      const xscalePct = 50 + Math.floor(Math.random() * 50);
      const yscalePct = 80 + Math.floor(Math.random() * 60);
      const startFrame = Math.floor(Math.random() * 45);

      const s32Anim = this.anims.add(new FrameAnimatedSprite({
        textures: sprite32Textures,
        anchorX: sprite32Anchor.x,
        anchorY: sprite32Anchor.y,
        scale: init.scale,
        startFrame,
      }));
      s32Anim.sprite.rotation = (rotDeg * Math.PI) / 180;
      s32Anim.sprite.scale.set(
        (xscalePct / 100) * init.scale,
        (yscalePct / 100) * init.scale,
      );
      s32Anim.stopAt(135);
      s32Anim.addTo(this.targetContainer);
    }

    // sprite_25 instances within target area
    // AS: _rotation = random(360); t = 30+random(50); _xscale=t; _yscale=t; stop at frame 13
    const sprite25Textures = textures.getFrames('sprite_25');
    const sprite25Anchor = calculateAnchor(SPRITE_25_MANIFEST);
    const sprite25Count = 4;
    for (let i = 0; i < sprite25Count; i++) {
      const rotation = Math.floor(Math.random() * 360);
      const t = 30 + Math.floor(Math.random() * 50);

      const s25Anim = this.anims.add(new FrameAnimatedSprite({
        textures: sprite25Textures,
        anchorX: sprite25Anchor.x,
        anchorY: sprite25Anchor.y,
        scale: init.scale,
      }));
      s25Anim.sprite.rotation = (rotation * Math.PI) / 180;
      s25Anim.sprite.scale.set((t / 100) * init.scale);
      s25Anim.stopAt(12);
      s25Anim.addTo(this.targetContainer);
    }

    // sprite_19 instances within target area
    // AS: gotoAndPlay(random(10)) → startFrame 0..9; stop at frame 61 (0-indexed: 60)
    const sprite19Textures = textures.getFrames('sprite_19');
    const sprite19Anchor = calculateAnchor(SPRITE_19_MANIFEST);
    const sprite19Count = 3;
    for (let i = 0; i < sprite19Count; i++) {
      const startFrame = Math.floor(Math.random() * 10);

      const s19Anim = this.anims.add(new FrameAnimatedSprite({
        textures: sprite19Textures,
        anchorX: sprite19Anchor.x,
        anchorY: sprite19Anchor.y,
        scale: init.scale,
        startFrame,
      }));
      s19Anim.stopAt(60);
      s19Anim.addTo(this.targetContainer);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
  }
}
