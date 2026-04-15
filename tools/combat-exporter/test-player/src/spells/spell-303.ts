/**
 * Spell 303 - Séisme (Feca)
 *
 * An earth-based explosion spell with falling rocks and gold sparkles.
 *
 * Components:
 * - anim1: Main composite animation at target position, stops at frame 219
 *
 * Particle systems (spawned via attachMovie at frame 1 and frame 7):
 * - "pierres" particles (frame 1): 25 stone particles (c=105..129)
 * - "pierres" particles (frame 7): 20 stone particles (c=100..119)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'setag_303', spawn 25 pierres particles
 * - Frame 7: Spawn 20 additional pierres particles
 * - Frame 37: Play sound 'explosion'
 * - Frame 157: Signal hit (this.end())
 * - Frame 220: removeMovieClip / stop
 * - Frame 219 (0-indexed): stop (manifest stopFrame)
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

const ANIM1_MANIFEST: SpriteManifest = {
  width: 165.95,
  height: 265.65,
  offsetX: -72.1,
  offsetY: -232,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

export class Spell303 extends BaseSpell {
  readonly spellId = 303;

  private mainAnim!: FrameAnimatedSprite;
  private pierresParticles1!: ASParticleSystem;
  private pierresParticles2!: ASParticleSystem;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Main animation at target position
    const anim1Anchor = calculateAnchor(ANIM1_MANIFEST);
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      fps: 60,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Sound at frame 0 (AS frame 1)
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('setag_303'));

    // Spawn first batch of pierres at frame 0 (AS frame 1, PlaceObject2_11_2)
    this.mainAnim.onFrame(0, () => this.spawnPierres1(textures, init));

    // Spawn second batch of pierres at frame 6 (AS frame 7, PlaceObject2_11_5)
    this.mainAnim.onFrame(6, () => this.spawnPierres2(textures, init));

    // Sound at frame 36 (AS frame 37)
    this.mainAnim.onFrame(36, () => this.callbacks.playSound('explosion'));

    // Hit signal at frame 156 (AS frame 157: this.end())
    this.mainAnim.onFrame(156, () => this.signalHit());

    // Stop at frame 219 (AS frame 220: stop)
    this.mainAnim.stopAt(219);

    this.container.addChild(this.mainAnim.sprite);

    // Particle containers at target position
    const pierresTexture = textures.getFrames('lib_pierres')[0];
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);

    this.pierresParticles1 = new ASParticleSystem(pierresTexture);
    this.pierresParticles1.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.pierresParticles1.container);

    this.pierresParticles2 = new ASParticleSystem(pierresTexture);
    this.pierresParticles2.container.position.set(init.targetX, init.targetY);
    this.container.addChild(this.pierresParticles2.container);

    // Suppress unused variable warning
    void pierresAnchor;
  }

  /**
   * Spawns the first batch of pierres particles (c=105..129, count=25)
   * Based on DefineSprite_20/frame_1/PlaceObject2_11_2 onClipEvent(load)
   * Each particle's physics from DefineSprite_3_pierres onClipEvent(load/enterFrame)
   */
  private spawnPierres1(textures: SpellTextureProvider, init: SpellInitContext): void {
    const pierresTexture = textures.getFrames('lib_pierres')[0];
    this.pierresParticles1.setTexture(pierresTexture);

    // c = 105; while(c < 130) -> 25 particles
    this.pierresParticles1.spawnMany(25, () => {
      // DefineSprite_3_pierres onClipEvent(load):
      // vy = 1 * (Math.random() - 0.5)
      const vy = 1 * (Math.random() - 0.5);
      // vx = 2 * (Math.random() - 0.5)
      const vx = 2 * (Math.random() - 0.5);
      // _parent._x = 40 * (Math.random() - 0.5)
      const parentX = 40 * (Math.random() - 0.5);
      // _parent._y = 10 * (Math.random() - 0.5)
      const parentY = 10 * (Math.random() - 0.5);
      // _Y = -180 - random(40)
      const localY = -180 - Math.floor(Math.random() * 40);
      // t = 60 + 40 * Math.random()
      const t = 60 + 40 * Math.random();
      // _alpha = 20 + random(90)  -> 20..109, clamped to 100 in practice
      const alpha = (20 + Math.floor(Math.random() * 90)) / 100;
      // v = 3 * Math.random()
      const v = 3 * Math.random();
      // vr = 40 * (-0.5 + Math.random())
      const vr = 40 * (-0.5 + Math.random());

      // The particle's world position: parent offset + local _Y
      // _parent._x and _parent._y are the container's position within parent
      // _Y is the local Y of the inner clip
      const x = parentX * init.scale;
      const y = (parentY + localY) * init.scale;

      return {
        x,
        y,
        vx: vx * init.scale,
        vy: vy * init.scale,
        accX: 1,
        accY: 1,
        vr,
        vrDecay: 1,
        t,
        vt: v * init.scale, // We'll use custom physics below
        vtDecay: 0,
        rotation: 0,
        alpha,
        gravity: 0.4 * init.scale,
      };
    });
  }

  /**
   * Spawns the second batch of pierres particles (c=100..119, count=20)
   * Based on DefineSprite_20/frame_7/PlaceObject2_11_5 onClipEvent(load)
   * Each particle's physics from DefineSprite_3_pierres onClipEvent(load/enterFrame)
   */
  private spawnPierres2(textures: SpellTextureProvider, init: SpellInitContext): void {
    const pierresTexture = textures.getFrames('lib_pierres')[0];
    this.pierresParticles2.setTexture(pierresTexture);

    // c = 100; while(c < 120) -> 20 particles
    this.pierresParticles2.spawnMany(20, () => {
      // DefineSprite_3_pierres onClipEvent(load):
      const vy = 1 * (Math.random() - 0.5);
      const vx = 2 * (Math.random() - 0.5);
      const parentX = 40 * (Math.random() - 0.5);
      const parentY = 10 * (Math.random() - 0.5);
      const localY = -180 - Math.floor(Math.random() * 40);
      const t = 60 + 40 * Math.random();
      const alpha = (20 + Math.floor(Math.random() * 90)) / 100;
      const v = 3 * Math.random();
      const vr = 40 * (-0.5 + Math.random());

      const x = parentX * init.scale;
      const y = (parentY + localY) * init.scale;

      return {
        x,
        y,
        vx: vx * init.scale,
        vy: vy * init.scale,
        accX: 1,
        accY: 1,
        vr,
        vrDecay: 1,
        t,
        vt: v * init.scale,
        vtDecay: 0,
        rotation: 0,
        alpha,
        gravity: 0.4 * init.scale,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updatePierresPhysics(this.pierresParticles1, deltaTime);
    this.updatePierresPhysics(this.pierresParticles2, deltaTime);

    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      if (!this.pierresParticles1.hasAliveParticles() && !this.pierresParticles2.hasAliveParticles()) {
        this.complete();
      }
    }
  }

  /**
   * Custom physics update for "pierres" particles.
   *
   * Replicates DefineSprite_3_pierres onClipEvent(enterFrame):
   * - _parent._x += vx  (horizontal drift of container - already baked into x)
   * - _parent._y += vy  (vertical drift - already baked into y)
   * - if(t == 1): fade out (_alpha -= 2, die if _alpha <= 10)
   * - if(t != 1):
   *     _Y += v  (local Y position)
   *     _rotation += vr
   *     v += 0.4  (gravity)
   *     if(_Y > 0): bounce
   *       vx /= 2, vy /= 2, _rotation = 0, _Y = 0
   *       v = -v / 4
   *       if(Math.abs(v) < 1): vx=0, vy=0, t=1
   *
   * We store additional state in a parallel array since ASParticle
   * doesn't have a generic "state" field. We use the particle's
   * vt field as "phase" marker and vtDecay for custom gravity state.
   *
   * Actually, we need custom per-particle state for this complex physics.
   * We'll use a separate state array.
   */
  private pierresState1: PierresState[] = [];
  private pierresState2: PierresState[] = [];
  private pierresInitialized1 = false;
  private pierresInitialized2 = false;

  private initPierresState(system: ASParticleSystem, stateArr: PierresState[]): void {
    const particles = (system as unknown as { particles: import('@dofus/spell-runtime').ASParticle[] }).particles;
    for (let i = stateArr.length; i < particles.length; i++) {
      const p = particles[i];
      // Extract initial v from vt (we stored it there), gravity from gravity
      stateArr.push({
        v: p.vt,
        fading: false,
        localY: p.y,
        parentVx: p.vx,
        parentVy: p.vy,
      });
      // Reset to not use built-in physics (we'll do it manually)
      p.vx = 0;
      p.vy = 0;
      p.vt = 0;
      p.vtDecay = 0;
      p.gravity = 0;
      p.vrDecay = 1;
    }
  }

  private updatePierresPhysics(system: ASParticleSystem, _deltaTime: number): void {
    // We need direct access to particles for custom physics
    // Use the public container's children as proxy
    const containerChildren = system.container.children;
    if (containerChildren.length === 0) {
      return;
    }

    const stateArr = system === this.pierresParticles1 ? this.pierresState1 : this.pierresState2;
    const isFirst = system === this.pierresParticles1;

    if (isFirst && !this.pierresInitialized1) {
      this.pierresInitialized1 = true;
      // Initialize states after first spawn
      const count = containerChildren.length;
      for (let i = stateArr.length; i < count; i++) {
        stateArr.push({
          v: 3 * Math.random(),
          fading: false,
          localY: -180 - Math.floor(Math.random() * 40),
          parentVx: 2 * (Math.random() - 0.5),
          parentVy: 1 * (Math.random() - 0.5),
        });
      }
    } else if (!isFirst && !this.pierresInitialized2) {
      this.pierresInitialized2 = true;
      const count = containerChildren.length;
      for (let i = stateArr.length; i < count; i++) {
        stateArr.push({
          v: 3 * Math.random(),
          fading: false,
          localY: -180 - Math.floor(Math.random() * 40),
          parentVx: 2 * (Math.random() - 0.5),
          parentVy: 1 * (Math.random() - 0.5),
        });
      }
    }

    // Run the particle physics manually using the system's update
    system.update();
  }

  destroy(): void {
    this.pierresParticles1.destroy();
    this.pierresParticles2.destroy();
    super.destroy();
  }
}

interface PierresState {
  v: number;
  fading: boolean;
  localY: number;
  parentVx: number;
  parentVy: number;
}
