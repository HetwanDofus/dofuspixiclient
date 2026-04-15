/**
 * Spell 2054 - Herbe/Coquille
 *
 * A projectile spell that travels from caster to target with a bubble particle effect.
 *
 * Components:
 * - sprite_10 (DefineSprite_10): Main projectile at caster position, rotated toward target, stops at frame 45
 * - sprite_9 (DefineSprite_9): Sub-sprite within sprite_10, rotated by angle, stops at frame 24
 * - sprite_13 (DefineSprite_13): Impact animation at target position, signals hit at frame 23, ends at frame 44
 * - sprite_12 (DefineSprite_12): Sub-sprite within sprite_13, counter-rotated, stops at frame 11
 * - sprite_4 (DefineSprite_5_bulle): Bubble particles attached to projectile, random start frame, stops at frame 51
 *
 * Original AS timing:
 * - Frame 1 (sprite_10): Play sound 'herbe', set position/rotation
 * - Frame 1 (sprite_9 within sprite_10): Rotated by parent angle
 * - Frame 2 (main): Play sound 'jet_903', stop
 * - Frame 24 (sprite_13): Signal hit (this.end()), play sound 'coquille'
 * - Frame 24 (sprite_12 within sprite_13): Counter-rotated by -angle
 * - Frame 25 (sprite_9): stop()
 * - Frame 45 (sprite_13): removeMovieClip()
 * - Frame 46 (sprite_10): stop()
 * - Frame 52 (sprite_4): stop()
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const PROJECTILE_MANIFEST: SpriteManifest = {
  width: 215.4,
  height: 86.6,
  offsetX: -48.2,
  offsetY: -74.15,
};

const BEAM_MANIFEST: SpriteManifest = {
  width: 215.4,
  height: 37.85,
  offsetX: -47.2,
  offsetY: -19.15,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 279.7,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

const IMPACT_INNER_MANIFEST: SpriteManifest = {
  width: 127.9,
  height: 127.9,
  offsetX: -63.95,
  offsetY: -63.95,
};

const BUBBLE_MANIFEST: SpriteManifest = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

export class Spell2054 extends BaseSpell {
  readonly spellId = 2054;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // ---- Main projectile (DefineSprite_10 / sprite_10) ----
    // Position: caster position (cellFrom), rotated toward target
    // Frame 1: play sound 'herbe', positioned at caster
    // Frame 46: stop()
    const projectileAnchor = calculateAnchor(PROJECTILE_MANIFEST);
    const projectileAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      anchorX: projectileAnchor.x,
      anchorY: projectileAnchor.y,
      scale: init.scale,
    }));
    projectileAnim.sprite.position.set(0, init.casterY);
    projectileAnim.sprite.rotation = init.angleRad;
    projectileAnim
      .stopAt(45)
      .onFrame(0, () => this.callbacks.playSound('herbe'));
    this.container.addChild(projectileAnim.sprite);

    // ---- Beam sub-sprite (DefineSprite_9 / sprite_9) within projectile ----
    // Rotated by parent angle (onClipEvent load: _rotation = _parent.angle)
    // Frame 25: stop()
    const beamAnchor = calculateAnchor(BEAM_MANIFEST);
    const beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      anchorX: beamAnchor.x,
      anchorY: beamAnchor.y,
      scale: init.scale,
    }));
    // The beam is a child of the projectile container, but since we flatten the hierarchy,
    // position it at caster and apply the same rotation
    beamAnim.sprite.position.set(0, init.casterY);
    beamAnim.sprite.rotation = init.angleRad;
    beamAnim.stopAt(24);
    this.container.addChild(beamAnim.sprite);

    // ---- Bubble particles (DefineSprite_5_bulle / sprite_4) ----
    // Attached to caster position, random start frame (random(15) + 1 -> 1-15, 0-indexed: 1-15)
    // The bubble has physics: vx, vy with friction rx, ry
    // Frame 52: stop()
    // We create a few bubbles to represent the DefineSprite_5_bulle effect
    const bubbleAnchor = calculateAnchor(BUBBLE_MANIFEST);
    const bubbleTextures = textures.getFrames('sprite_4');

    // The bulle sprite contains a sprite_4 with random start frame and physics
    // We simulate this with a single bubble instance (the AS places one sprite_4 inside bulle)
    const startFrame = Math.floor(Math.random() * 15) + 1;
    const bubbleAnim = this.anims.add(new FrameAnimatedSprite({
      textures: bubbleTextures,
      anchorX: bubbleAnchor.x,
      anchorY: bubbleAnchor.y,
      scale: init.scale,
      startFrame,
    }));

    // AS physics from DefineSprite_5_bulle frame_1/DoAction.as:
    // rx = 0.7 + 0.15 * Math.random()
    // ry = 0.8 + 0.15 * Math.random()
    // vx = 20 + random(25)
    // vy = -15 + random(30)
    // _alpha = random(50) + 50
    const rx = 0.7 + 0.15 * Math.random();
    const ry = 0.8 + 0.15 * Math.random();
    let vx = 20 + Math.floor(Math.random() * 25);
    let vy = -15 + Math.floor(Math.random() * 30);
    const alpha = Math.floor(Math.random() * 50) + 50;

    bubbleAnim.sprite.position.set(0, init.casterY);
    bubbleAnim.sprite.alpha = alpha / 100;
    bubbleAnim.stopAt(51);
    this.container.addChild(bubbleAnim.sprite);

    // Store bubble physics state for update
    this._bubbleAnim = bubbleAnim;
    this._bubbleVx = vx;
    this._bubbleVy = vy;
    this._bubbleRx = rx;
    this._bubbleRy = ry;

    // ---- Impact animation (DefineSprite_13 / sprite_13) at target position ----
    // Frame 1: _X = cellTo.x, _Y = cellTo.y, _rotation = angle
    // Frame 24: this.end() (signal hit), play sound 'coquille'
    // Frame 45: removeMovieClip()
    const impactAnchor = calculateAnchor(IMPACT_MANIFEST);
    const impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_13'),
      anchorX: impactAnchor.x,
      anchorY: impactAnchor.y,
      scale: init.scale,
    }));
    impactAnim.sprite.position.set(init.targetX, init.targetY);
    impactAnim.sprite.rotation = init.angleRad;
    impactAnim
      .onFrame(23, () => {
        this.signalHit();
        this.callbacks.playSound('coquille');
      });
    this.container.addChild(impactAnim.sprite);

    // ---- Inner impact sprite (DefineSprite_12 / sprite_12) within impact ----
    // onClipEvent(load): _rotation = -_parent._parent.angle
    // Frame 12: stop()
    const impactInnerAnchor = calculateAnchor(IMPACT_INNER_MANIFEST);
    const impactInnerAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_12'),
      anchorX: impactInnerAnchor.x,
      anchorY: impactInnerAnchor.y,
      scale: init.scale,
    }));
    // Counter-rotated: _rotation = -angle
    impactInnerAnim.sprite.position.set(init.targetX, init.targetY);
    impactInnerAnim.sprite.rotation = -init.angleRad;
    impactInnerAnim.stopAt(11);
    this.container.addChild(impactInnerAnim.sprite);

    this._impactAnim = impactAnim;
  }

  private _bubbleAnim!: FrameAnimatedSprite;
  private _bubbleVx = 0;
  private _bubbleVy = 0;
  private _bubbleRx = 0;
  private _bubbleRy = 0;
  private _impactAnim!: FrameAnimatedSprite;

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Apply bubble physics each frame (AS: onEnterFrame)
    // _X = _X + (vx *= rx)
    // _Y = _Y + (vy *= ry)
    this._bubbleVx *= this._bubbleRx;
    this._bubbleVy *= this._bubbleRy;
    this._bubbleAnim.sprite.x += this._bubbleVx;
    this._bubbleAnim.sprite.y += this._bubbleVy;

    // Complete when impact animation is done (frame 45 = index 44, plays through all 45 frames)
    if (this._impactAnim.isComplete()) {
      this.complete();
    }
  }
}
