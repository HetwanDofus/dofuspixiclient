/**
 * Spell 615 - Esquive (Dodge/Air)
 *
 * A dodge/air spell with stone particle effects at the target position.
 *
 * Components:
 * - Main animation (sprite_22): At target position, plays through to frame 121
 * - Two stone particle bursts (pierres): Spawned at frames 37 and 43 of sprite_22
 *
 * Original AS timing:
 * - Frame 1 (sprite_22): Play sound 'air', position at cellTo
 * - Frame 34 (sprite_22): Play sound 'dodge_615'
 * - Frame 37 (sprite_22): Spawn first batch of 5 'pierres' particles
 * - Frame 40 (sprite_22): Signal hit (this.end())
 * - Frame 43 (sprite_22): Play sound 'dodge_615', spawn second batch of 5 'pierres' particles
 * - Frame 121 (sprite_22): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  ASParticleSystem,
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

const SPRITE_22_MANIFEST: SpriteManifest = {
  width: 239.5,
  height: 178.9,
  offsetX: -113.3,
  offsetY: -132.1,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 4.75,
  height: 2.3,
  offsetX: -2.4,
  offsetY: -1.7,
};

export class Spell615 extends BaseSpell {
  readonly spellId = 615;

  private mainAnim!: FrameAnimatedSprite;
  private particles1!: ASParticleSystem;
  private particles2!: ASParticleSystem;
  private particlesContainer1!: Container;
  private particlesContainer2!: Container;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const mainTextures = textures.getFrames("sprite_22");
    const anchor = calculateAnchor(SPRITE_22_MANIFEST);

    const pierresTexture = textures.getFrames("lib_pierres")[0];
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);

    // Particle containers positioned at target
    this.particlesContainer1 = new Container();
    this.particlesContainer1.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particlesContainer1);

    this.particlesContainer2 = new Container();
    this.particlesContainer2.position.set(init.targetX, init.targetY);
    this.container.addChild(this.particlesContainer2);

    // Particle systems
    this.particles1 = new ASParticleSystem(pierresTexture);
    this.particles1.container.position.set(0, 0);
    this.particlesContainer1.addChild(this.particles1.container);

    this.particles2 = new ASParticleSystem(pierresTexture);
    this.particles2.container.position.set(0, 0);
    this.particlesContainer2.addChild(this.particles2.container);

    // Main animation (sprite_22) at target position
    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y;
    this.mainAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: mainTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): Play sound 'air'
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound("air");
    });

    // Frame 34 (0-indexed: 33): Play sound 'dodge_615'
    this.mainAnim.onFrame(33, () => {
      this.callbacks.playSound("dodge_615");
    });

    // Frame 37 (0-indexed: 36): Spawn first batch of 5 pierres
    this.mainAnim.onFrame(36, () => {
      this.spawnPierres(this.particles1, pierresAnchor);
    });

    // Frame 40 (0-indexed: 39): Signal hit (this.end())
    this.mainAnim.onFrame(39, () => {
      this.signalHit();
    });

    // Frame 43 (0-indexed: 42): Play sound 'dodge_615', spawn second batch
    this.mainAnim.onFrame(42, () => {
      this.callbacks.playSound("dodge_615");
      this.spawnPierres(this.particles2, pierresAnchor);
    });

    // Frame 121 (0-indexed: 120): removeMovieClip() - stop here
    this.mainAnim.stopAt(120);

    this.container.addChild(this.mainAnim.sprite);
  }

  private spawnPierres(
    particleSystem: ASParticleSystem,
    _anchor: { x: number; y: number }
  ): void {
    // AS: c = 0; while(c < 5) { this.attachMovie("pierres","pierres" + c,c); c++; }
    // Each pierre has onClipEvent(load) and onClipEvent(enterFrame) on PlaceObject2_2_1

    particleSystem.spawnMany(5, () => {
      // onClipEvent(load):
      // vx = 3 * (Math.random() - 0.5);
      const vx = 3 * (Math.random() - 0.5);
      // vy = 2 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);
      // _parent._x = 20 * (Math.random() - 0.5);
      const px = 20 * (Math.random() - 0.5);
      // _parent._y = 10 * (Math.random() - 0.5);
      const py = 10 * (Math.random() - 0.5);
      // t = 60 + 40 * Math.random();
      const t = 60 + 40 * Math.random();
      // _alpha = 20 + random(90);
      const alpha = (20 + Math.floor(Math.random() * 90)) / 100;
      // v = -6 * Math.random() - 3;
      const v = -6 * Math.random() - 3;
      // vr = 40 * (-0.5 + Math.random());
      const vr = 40 * (-0.5 + Math.random());

      return {
        x: px,
        y: py,
        vx,
        vy,
        accX: 1,
        accY: 1,
        vr,
        vrDecay: 1,
        t,
        vt: v,
        vtDecay: -0.5, // v += 0.5 each frame means vtDecay = -0.5 (subtracted from vt)
        rotation: 0,
        alpha,
        alphaVelocity: 0,
        gravity: 0,
      };
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.particles1.update();
    this.particles2.update();

    if (
      this.mainAnim.isStopped() &&
      !this.particles1.hasAliveParticles() &&
      !this.particles2.hasAliveParticles()
    ) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles1.destroy();
    this.particles2.destroy();
    super.destroy();
  }
}
