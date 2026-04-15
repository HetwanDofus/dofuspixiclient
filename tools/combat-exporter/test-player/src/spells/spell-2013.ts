/**
 * Spell 2013 - Boo (Osamodas)
 *
 * A spell with two main components:
 * - DefineSprite_10 (sprite_9 + sprite_10): Beam/channel at caster position, rotated toward target
 * - DefineSprite_11 (sprite_11): Impact at target position, spawns bubble particles at frame 47
 *
 * Components:
 * - sprite_9: Inner channel beam at caster, stops at frame 16 (AS frame 17)
 * - sprite_10: Outer channel beam at caster, stops at frame 45 (AS frame 46)
 * - sprite_11: Impact animation at target, signals hit at frame 46 (AS frame 47)
 * - bulle particles: 6 bubbles spawned at frame 46 of sprite_11
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'boo_up'
 * - Frame 2 (main): Play sound 'jet_903', stop main timeline
 * - DefineSprite_10 frame 1: Play 'boo_up', set position to cellFrom (x, y-25)
 * - DefineSprite_10 frame 46: stop()
 * - DefineSprite_9 (child of DefineSprite_10) frame 17: stop(), rotation = parent.angle
 * - DefineSprite_11 frame 1: Set position to cellTo (x, y-30), rotation = angle
 * - DefineSprite_11 frame 47: attachMovie("bulle", ...) x6, this.end()
 * - DefineSprite_11 frame 89: removeMovieClip()
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

const SPRITE_9_MANIFEST: SpriteManifest = {
  width: 214.45,
  height: 36.7,
  offsetX: -47,
  offsetY: -18.35,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 214.45,
  height: 62.75,
  offsetX: -48,
  offsetY: -60.05,
};

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 237.45,
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

export class Spell2013 extends BaseSpell {
  readonly spellId = 2013;

  private channelAnim!: FrameAnimatedSprite;  // sprite_10 (outer channel)
  private beamAnim!: FrameAnimatedSprite;     // sprite_9 (inner beam, child of channel)
  private impactAnim!: FrameAnimatedSprite;   // sprite_11 (impact at target)
  private particles!: ASParticleSystem;
  private bubblesSpawned = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // ---- Channel at caster position (DefineSprite_10) ----
    // Contains sprite_10 (outer) and sprite_9 (inner, rotated)
    // Position: cellFrom.x, cellFrom.y - 25
    // In our coordinate system (container at cellFrom): 0, -25 + Y_OFFSET correction
    // AS: _X = cellFrom.x, _Y = cellFrom.y - 25
    // Since our container is placed at cellFrom, caster offset is (0, -25)
    // But init.casterY is already Y_OFFSET (-50), so we need -25 relative to the cell
    // The container is at cellFrom position, so we use (0, -25) directly in cell coords
    // init.casterY = SPELL_CONSTANTS.Y_OFFSET = -50
    // AS sets _Y = cellFrom.y - 25, which is cellFrom.y - 25. Relative to cellFrom: -25
    const casterOffsetY = -25;

    // sprite_10 (outer channel beam) - stops at frame 45 (AS frame 46)
    const sprite10Anchor = calculateAnchor(SPRITE_10_MANIFEST);
    this.channelAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_10'),
      fps: 40,
      anchorX: sprite10Anchor.x,
      anchorY: sprite10Anchor.y,
      scale: init.scale,
    }));
    this.channelAnim.sprite.position.set(0, casterOffsetY);
    this.channelAnim
      .stopAt(45)
      .onFrame(0, () => this.callbacks.playSound('boo_up'));
    this.container.addChild(this.channelAnim.sprite);

    // sprite_9 (inner beam) - child of DefineSprite_10 container
    // Rotation set on load: _rotation = _parent._parent.angle
    const sprite9Anchor = calculateAnchor(SPRITE_9_MANIFEST);
    this.beamAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_9'),
      fps: 40,
      anchorX: sprite9Anchor.x,
      anchorY: sprite9Anchor.y,
      scale: init.scale,
    }));
    this.beamAnim.sprite.position.set(0, casterOffsetY);
    this.beamAnim.sprite.rotation = init.angleRad;
    this.beamAnim.stopAt(16); // AS frame 17: stop()
    this.container.addChild(this.beamAnim.sprite);

    // ---- Impact at target position (DefineSprite_11) ----
    // AS: _X = cellTo.x, _Y = cellTo.y - 30, _rotation = angle
    // Relative to container at cellFrom: targetX, targetY - 30 + 50 (undo Y_OFFSET) - wait...
    // init.targetX = cellTo.x - cellFrom.x
    // init.targetY = (cellTo.y - cellFrom.y) + Y_OFFSET = (cellTo.y - cellFrom.y) - 50
    // AS sets absolute positions. We need relative to cellFrom container.
    // AS: _Y = cellTo.y - 30 → relative to cellFrom: (cellTo.y - cellFrom.y) - 30
    // init.targetY = (cellTo.y - cellFrom.y) - 50
    // So targetY for impact = init.targetY + 50 - 30 = init.targetY + 20
    const impactY = init.targetY + 20; // compensate: init.targetY has -50, we need -30
    const sprite11Anchor = calculateAnchor(SPRITE_11_MANIFEST);
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_11'),
      fps: 40,
      anchorX: sprite11Anchor.x,
      anchorY: sprite11Anchor.y,
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, impactY);
    this.impactAnim.sprite.rotation = init.angleRad;
    this.impactAnim
      .onFrame(46, () => this.spawnBubbles(init, impactY))
      .onFrame(46, () => this.signalHit());
    // Frame 89 (AS frame 89): removeMovieClip() - animation ends naturally at last frame
    this.container.addChild(this.impactAnim.sprite);

    // ---- Particle system for bubbles ----
    const bulleTexture = textures.getFrames('lib_bulle')[0];
    this.particles = new ASParticleSystem(bulleTexture);
    // Particles are positioned relative to the impact sprite origin
    this.container.addChild(this.particles.container);

    // Sound at main frame 2 (0-indexed: 1)
    // AS frame_2/DoAction.as: SOMA.playSound("jet_903"); stop();
    // This fires on second frame of main timeline - approximate with a small delay
    // We trigger it via the impact anim frame 1 (second frame of overall animation)
    this.impactAnim.onFrame(1, () => this.callbacks.playSound('jet_903'));
  }

  private spawnBubbles(init: SpellInitContext, impactY: number): void {
    if (this.bubblesSpawned) {
      return;
    }
    this.bubblesSpawned = true;

    // AS: c = 1; while(c < 7) -> spawns 6 bubbles (c = 1..6)
    // Each bubble: DefineSprite_5_bulle
    // onClipEvent(load): gotoAndPlay(random(15) + 1) -> start at random frame 1-15 (0-indexed: 0-14)
    // frame_1/DoAction.as:
    //   rx = 0.7 + 0.15 * Math.random()
    //   ry = 0.8 + 0.15 * Math.random()
    //   vx = 20 + random(25)
    //   vy = -15 + random(30)
    //   _alpha = random(50) + 50
    //   onEnterFrame: _X += (vx *= rx); _Y += (vy *= ry)

    // Position particles at the impact position
    this.particles.container.position.set(init.targetX, impactY);

    this.particles.spawnMany(6, () => {
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
        t: 100,
        vt: 0,
        vtDecay: 0,
        vr: 0,
        vrDecay: 1,
        alpha,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles.update();

    // Complete when impact animation finishes (frame 89 = last frame, index 88)
    // and all bubbles are gone
    if (this.impactAnim.isComplete() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
