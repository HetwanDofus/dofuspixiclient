/**
 * Spell 2928 - Firework/Bat Wings spell
 *
 * A firework-style spell with a bird/bat creature that flies and explodes.
 *
 * Components:
 * - shoot (sprite_shoot): Main animation at target position, 291 frames
 *   - Plays "bat_ailes" sound at frame 0
 *   - Plays "explo_fireworks" sound at frame 57
 *   - Signals hit at frame 57 (explosion)
 *   - Spawns "feux" fire particles at frame 63 (AS frame 64)
 *   - Spawns "plumes2" feather particles at frame 63 (AS frame 64)
 *   - Stops at frame 84 (AS frame 85)
 *   - Completes at frame 288 (AS frame 289 removeMovieClip)
 *
 * Original AS timing (DefineSprite_24):
 * - Frame 1: playSound("bat_ailes"), stop() on inner sprite
 * - Frame 16: gotoAndPlay(1) - loop
 * - Frame 37: inner sprite enterFrame handler
 * - Frame 58: playSound("explo_fireworks")
 * - Frame 64: attachMovie feux (19 instances) + plumes2 (9 instances)
 * - Frame 85: stop()
 *
 * DefineSprite_3_shoot:
 * - Frame 289: _parent.removeMovieClip() + stop()
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

const SHOOT_MANIFEST: SpriteManifest = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

const FEUX_MANIFEST: SpriteManifest = {
  width: 9,
  height: 9,
  offsetX: -4.55,
  offsetY: -4.4,
};

const PLUMES2_MANIFEST: SpriteManifest = {
  width: 14.6,
  height: 14.6,
  offsetX: -6.9,
  offsetY: 17.55,
};

const PLUMES_MANIFEST: SpriteManifest = {
  width: 14.6,
  height: 14.6,
  offsetX: -9.9,
  offsetY: -52.45,
};

export class Spell2928 extends BaseSpell {
  readonly spellId = 2928;

  private shootAnim!: FrameAnimatedSprite;
  private feuxParticles!: ASParticleSystem;
  private plumes2Particles!: ASParticleSystem;
  private particlesSpawned = false;
  private targetX = 0;
  private targetY = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.targetX = init.targetX;
    this.targetY = init.targetY;

    // Main shoot animation at target position
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): play bat_ailes sound
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('bat_ailes');
    });

    // Frame 57 (AS frame 58): play explo_fireworks sound + signal hit
    this.shootAnim.onFrame(57, () => {
      this.callbacks.playSound('explo_fireworks');
      this.signalHit();
    });

    // Frame 63 (AS frame 64): spawn feux and plumes2 particles
    this.shootAnim.onFrame(63, () => {
      this.spawnParticles();
    });

    // Frame 288 (AS frame 289): removeMovieClip - animation ends
    this.shootAnim.onFrame(288, () => {
      this.complete();
    });

    this.container.addChild(this.shootAnim.sprite);

    // Particle systems
    const feuxTexture = textures.getFrames('lib_feux')[0];
    this.feuxParticles = new ASParticleSystem(feuxTexture);
    this.feuxParticles.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.feuxParticles.container);

    const plumes2Texture = textures.getFrames('lib_plumes2')[0];
    this.plumes2Particles = new ASParticleSystem(plumes2Texture);
    this.plumes2Particles.container.position.set(0, 0);
    this.container.addChild(this.plumes2Particles.container);
  }

  private spawnParticles(): void {
    if (this.particlesSpawned) {
      return;
    }
    this.particlesSpawned = true;

    // AS DefineSprite_24/frame_64:
    // i = 1; while(i < 20) { this.attachMovie("feux","feux" + i, i); i++; }
    // Spawns 19 feux particles (i from 1 to 19)
    //
    // feux particle physics (DefineSprite_12_feux):
    // onClipEvent(load):
    //   _parent._rotation = random(360)  -> parent rotation (ignored in our system, we randomize per particle)
    //   vg = -6 * Math.random()
    //   g = 1 * Math.random()            -> gravity
    //   va = 0
    //   t = 100 + random(100)            -> initial scale %
    //   _xscale = t; _yscale = t
    //   dmax = 100
    //   _X = 10 + random(20)             -> initial x offset
    //   d = dmax - random(70)            -> target x
    //   acc = 5 + Math.random() * 5
    //   vacc = 1.5 + 1.5 * Math.random()
    //
    // onClipEvent(enterFrame):
    //   _rotation = random(360)          -> random rotation each frame
    //   t = 40 + random(80)              -> random scale each frame
    //   _xscale = t; _yscale = t
    //   _parent._y += g
    //   _alpha = 150 - (va += vacc)      -> va accumulates, alpha decreases
    //   _X = _X - (_X - d) / acc        -> move toward d
    //   if(_alpha < 0) removeMovieClip()
    //
    // Note: The feux particle is complex with per-frame random rotation/scale.
    // We model it as particles with custom physics.
    // Alpha starts at 150/255 ~= 0.588 and decreases by vacc/255 per frame.
    // The _X motion: moves toward d exponentially (like lerp with factor 1/acc).
    // We'll approximate using the particle system with velocity/decay.

    for (let i = 1; i < 20; i++) {
      // Per-parent rotation (each feux has a parent with _parent._rotation = random(360))
      const parentRotation = Math.floor(Math.random() * 360);
      const parentRotRad = (parentRotation * Math.PI) / 180;

      // load vars
      const g = 1 * Math.random();
      let va = 0;
      const t = 100 + Math.floor(Math.random() * 100);
      const dmax = 100;
      const initialX = 10 + Math.floor(Math.random() * 20);
      const d = dmax - Math.floor(Math.random() * 70);
      const acc = 5 + Math.random() * 5;
      const vacc = 1.5 + 1.5 * Math.random();

      // Convert local x to world coordinates (parent has random rotation)
      const wx = initialX * Math.cos(parentRotRad);
      const wy = initialX * Math.sin(parentRotRad);

      // We need to track va and x per-particle for the enterFrame logic.
      // The ASParticleSystem doesn't support custom per-frame logic, so we
      // use it for basic rendering and handle motion via custom update.
      // However, since we can't easily hook into per-particle custom logic,
      // we'll approximate: the X moves toward d, which means vx starts positive
      // and decays. The net horizontal motion per frame is -(x - d) / acc.
      // Starting at initialX, target d: displacement = d - initialX.
      // This is an exponential approach: each frame x += (d - x) / acc
      // We model this as initial vx = (d - initialX) / acc with accX = 1 - 1/acc

      const vxLocal = (d - initialX) / acc;
      const accXLocal = 1 - 1 / acc;

      // In world space
      const vxWorld = vxLocal * Math.cos(parentRotRad);
      const vyWorld = vxLocal * Math.sin(parentRotRad) + g;

      // Alpha: starts at 150 (out of 255) = ~0.588, decreases by vacc/255 per frame
      // death when alpha < 0, i.e. when va > 150
      // frames until death: 150 / vacc
      const initialAlpha = 150 / 255;
      const alphaVelocity = -vacc / 255;

      this.feuxParticles.spawn({
        x: wx,
        y: wy,
        vx: vxWorld,
        vy: g,
        accX: accXLocal,
        accY: 1,
        gravity: 0,
        t: t,
        vt: 0,
        vtDecay: 0,
        rotation: Math.floor(Math.random() * 360),
        vr: Math.floor(Math.random() * 360) - 180,
        vrDecay: 0,
        alpha: initialAlpha,
        alphaVelocity: alphaVelocity,
      });
    }

    // AS DefineSprite_24/frame_64:
    // i = 1; while(i < 10) { _parent.attachMovie("plumes2","plumes2" + i, i); ... i++; }
    // Spawns 9 plumes2 particles (i from 1 to 9)
    // plume._x = _X (position of the firework)
    // plume._y = _Y (position of the firework)
    //
    // plumes2 physics (DefineSprite_6_plumes2):
    // onClipEvent(load):
    //   t = 30 + random(30)             -> scale %
    //   duree = 60 + random(30)         -> lifetime before fade
    //   vy = -10 + 20 * Math.random()
    //   vx = -10 + 20 * Math.random()
    //   vch = 0.1 + 0.1 * Math.random() -> gravity on vy
    //   vr = 0.03 + 0.1 * Math.random() -> angular frequency
    //   amp = 30 + random(50)            -> rotation amplitude
    //   a = 1.15                         -> phase
    //   time = 0
    //
    // onClipEvent(enterFrame):
    //   if(time++ > duree) { _alpha -= 3.34; }
    //   if(_Y < 0) {
    //     _Y += (vy += vch)
    //     _X += vx
    //     vy *= 0.9; vx *= 0.9
    //     amp *= 0.98
    //     _rotation = amp * Math.sin(a += vr)
    //   }
    //
    // Note: The _Y < 0 check means particles only move when Y < 0 (above origin).
    // The plumes2 are positioned at the firework (_X, _Y) which is the target position.
    // In our coordinate system, target is at (targetX, targetY).
    // The _Y < 0 condition in AS means the particle's local Y must be negative.
    // Since particles start at the firework position, and vy can be negative (going up),
    // they'll move upward (decreasing Y) - so _Y < 0 means they went above origin.
    // We'll model them starting at target position with the physics running freely.
    // The _Y < 0 gate effectively means they only animate when above the cast point.
    // We'll ignore the _Y < 0 gate and just let them animate (simplification needed
    // since ASParticleSystem doesn't support conditional physics).

    for (let i = 1; i < 10; i++) {
      const t = 30 + Math.floor(Math.random() * 30);
      const duree = 60 + Math.floor(Math.random() * 30);
      const vy = -10 + 20 * Math.random();
      const vx = -10 + 20 * Math.random();
      const vch = 0.1 + 0.1 * Math.random();

      // Alpha starts at 100%, fades after duree frames at -3.34% per frame
      // We'll use alphaVelocity = 0 for now and handle fade timing via vtDecay approximation
      // Since ASParticleSystem doesn't support delayed fade, we approximate:
      // total frames alive ~ duree + 100/3.34 ~= duree + 30
      // We start with alpha 1.0 and fade from the start very slowly then faster
      // Actually simplest: alpha decreases by 3.34/100 per frame after duree frames
      // We can't model the delay cleanly, so we'll set alphaVelocity = -3.34/100/duree
      // as an approximation to fade starting from birth
      // Better: just set alpha decay to start immediately but slower
      const alphaVelocity = -(3.34 / 100) / (duree / 30 + 1);

      this.plumes2Particles.spawn({
        x: this.targetX,
        y: this.targetY,
        vx: vx,
        vy: vy,
        accX: 0.9,
        accY: 0.9,
        gravity: vch,
        t: t,
        vt: 0,
        vtDecay: 0,
        rotation: 0,
        vr: 0,
        vrDecay: 1,
        alpha: 1.0,
        alphaVelocity: alphaVelocity,
      });
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.feuxParticles.update();
    this.plumes2Particles.update();

    if (this.shootAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    this.feuxParticles.destroy();
    this.plumes2Particles.destroy();
    super.destroy();
  }
}
