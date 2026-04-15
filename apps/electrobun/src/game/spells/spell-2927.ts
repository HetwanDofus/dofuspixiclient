/**
 * Spell 2927 - (Fireworks Bird)
 *
 * A bird-flight animation that explodes into fireworks.
 *
 * Components:
 * - shoot: Main animation (291 frames) at target position
 *   - Frame 1 (index 0): Play sound 'bat_ailes', spawn 10 plumes particles
 *   - Frame 58 (index 57): Play sound 'explo_fireworks', signal hit
 *   - Frame 64 (index 63): Spawn 19 feux particles + 9 plumes2 particles
 *   - Frame 85 (index 84): Stop
 *   - Frame 289 (index 288): Complete
 *
 * Original AS timing:
 * - DefineSprite_24/frame_1: playSound("bat_ailes")
 * - DefineSprite_2/frame_1: spawn 10 plumes
 * - DefineSprite_24/frame_58: playSound("explo_fireworks")
 * - DefineSprite_24/frame_64: spawn 19 feux + 9 plumes2
 * - DefineSprite_24/frame_85: stop()
 * - DefineSprite_3_shoot/frame_289: removeMovieClip / done
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import type { Sprite } from "pixi.js";
import {
  ASParticleSystem,
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
};

const PLUMES_MANIFEST: SpriteManifest = {
  width: 14.6,
  height: 14.6,
  offsetX: -9.9,
  offsetY: -52.45,
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

interface PlumesParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vch: number;
  vr: number;
  amp: number;
  a: number;
  time: number;
  duree: number;
  alpha: number;
  scale: number;
}

interface FeuxParticleState {
  parentY: number;
  t: number;
  alpha: number;
  va: number;
  vacc: number;
  x: number;
  d: number;
  acc: number;
  g: number;
  alive: boolean;
}

interface Plumes2ParticleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vch: number;
  vr: number;
  amp: number;
  a: number;
  time: number;
  duree: number;
  alpha: number;
  scale: number;
}

interface ParticleEntry {
  sprite: Sprite;
  alive: boolean;
}

export class Spell2927 extends BaseSpell {
  readonly spellId = 2927;

  private shootAnim!: FrameAnimatedSprite;

  private plumesParticles!: ASParticleSystem;
  private feuxParticles!: ASParticleSystem;
  private plumes2Particles!: ASParticleSystem;

  private plumesState: PlumesParticleState[] = [];
  private feuxState: FeuxParticleState[] = [];
  private plumes2State: Plumes2ParticleState[] = [];

  private plumesEntries: ParticleEntry[] = [];
  private feuxEntries: ParticleEntry[] = [];
  private plumes2Entries: ParticleEntry[] = [];

  private particleFrameAccum = 0;
  private readonly particleFrameTime = 1000 / 60;
  private shootFrameTracker = 0;

  private plumesSpawned = false;
  private feuxSpawned = false;
  private plumes2Spawned = false;

  private initScale = 1;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.initScale = init.scale;

    const anchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (index 0): play bat_ailes, spawn plumes
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound("bat_ailes");
      this.spawnInitialPlumes(textures);
    });

    // Frame 58 (index 57): play explo_fireworks + signal hit
    this.shootAnim.onFrame(57, () => {
      this.callbacks.playSound("explo_fireworks");
      this.signalHit();
    });

    // Frame 64 (index 63): spawn feux + plumes2
    this.shootAnim.onFrame(63, () => {
      this.spawnFeux(textures);
      this.spawnPlumes2(textures);
    });

    // Frame 85 (index 84): stop main anim
    this.shootAnim.stopAt(84);

    this.container.addChild(this.shootAnim.sprite);

    // Set up particle systems with placeholder textures (will be replaced on spawn)
    const plumesTextures = textures.getFrames("lib_plumes");
    const feuxTextures = textures.getFrames("lib_feux");
    const plumes2Textures = textures.getFrames("lib_plumes2");

    this.plumesParticles = new ASParticleSystem(plumesTextures[0]);
    this.feuxParticles = new ASParticleSystem(feuxTextures[0]);
    this.plumes2Particles = new ASParticleSystem(plumes2Textures[0]);

    this.plumesParticles.container.position.set(init.targetX, init.targetY);
    this.feuxParticles.container.position.set(init.targetX, init.targetY);
    this.plumes2Particles.container.position.set(init.targetX, init.targetY);

    this.container.addChild(this.plumesParticles.container);
    this.container.addChild(this.feuxParticles.container);
    this.container.addChild(this.plumes2Particles.container);
  }

  private spawnInitialPlumes(_textures: SpellTextureProvider): void {
    if (this.plumesSpawned) {
      return;
    }
    this.plumesSpawned = true;

    const plumesAnchor = calculateAnchor(PLUMES_MANIFEST);

    // DefineSprite_2/frame_1: c=0; p=0; while(p < 10) -> 10 plumes
    for (let p = 0; p < 10; p++) {
      // vx = 40 * (Math.random() - 0.5), vy = 40 * (Math.random() - 0.5)
      // DefineSprite_7_plumes load physics:
      const t = 30 + Math.floor(Math.random() * 30);
      const duree = 60 + Math.floor(Math.random() * 30);
      const vx = -10 + 20 * Math.random();
      const vy = 2 + 2 * Math.random();
      const vch = 0.1 + 0.1 * Math.random();
      const vr = 0.03 + 0.1 * Math.random();
      const amp = 30 + Math.floor(Math.random() * 50);
      const a = 1.15;

      const particle = this.plumesParticles.spawn({
        x: 0,
        y: 0,
        t: t,
        alpha: 1,
      });

      particle.sprite.anchor.set(plumesAnchor.x, plumesAnchor.y);
      particle.sprite.scale.set((t / 100) * this.initScale);

      this.plumesState.push({
        x: 0,
        y: 0,
        vx,
        vy,
        vch,
        vr,
        amp,
        a,
        time: 0,
        duree,
        alpha: 100,
        scale: t,
      });

      this.plumesEntries.push({ sprite: particle.sprite, alive: true });
    }
  }

  private spawnFeux(_textures: SpellTextureProvider): void {
    if (this.feuxSpawned) {
      return;
    }
    this.feuxSpawned = true;

    const feuxAnchor = calculateAnchor(FEUX_MANIFEST);

    // DefineSprite_24/frame_64: i=1; while(i < 20) -> 19 feux
    for (let i = 1; i < 20; i++) {
      // DefineSprite_12_feux load:
      const parentRotation = Math.floor(Math.random() * 360);
      const g = 1 * Math.random();
      const va = 0;
      const t = 100 + Math.floor(Math.random() * 100);
      const dmax = 100;
      const startX = 10 + Math.floor(Math.random() * 20);
      const d = dmax - Math.floor(Math.random() * 70);
      const acc = 5 + Math.random() * 5;
      const vacc = 1.5 + 1.5 * Math.random();

      const particle = this.feuxParticles.spawn({
        x: startX,
        y: 0,
        t: t,
        alpha: 1,
      });

      particle.sprite.anchor.set(feuxAnchor.x, feuxAnchor.y);
      particle.sprite.scale.set((t / 100) * this.initScale);
      particle.sprite.rotation = (parentRotation * Math.PI) / 180;

      this.feuxState.push({
        parentY: 0,
        t,
        alpha: 100,
        va,
        vacc,
        x: startX,
        d,
        acc,
        g,
        alive: true,
      });

      this.feuxEntries.push({ sprite: particle.sprite, alive: true });
    }
  }

  private spawnPlumes2(_textures: SpellTextureProvider): void {
    if (this.plumes2Spawned) {
      return;
    }
    this.plumes2Spawned = true;

    const plumes2Anchor = calculateAnchor(PLUMES2_MANIFEST);

    // DefineSprite_24/frame_64: i=1; while(i < 10) -> 9 plumes2
    for (let i = 1; i < 10; i++) {
      // DefineSprite_6_plumes2 load:
      const t = 30 + Math.floor(Math.random() * 30);
      const duree = 60 + Math.floor(Math.random() * 30);
      const vy = -10 + 20 * Math.random();
      const vx = -10 + 20 * Math.random();
      const vch = 0.1 + 0.1 * Math.random();
      const vr = 0.03 + 0.1 * Math.random();
      const amp = 30 + Math.floor(Math.random() * 50);
      const a = 1.15;

      const particle = this.plumes2Particles.spawn({
        x: 0,
        y: 0,
        t: t,
        alpha: 1,
      });

      particle.sprite.anchor.set(plumes2Anchor.x, plumes2Anchor.y);
      particle.sprite.scale.set((t / 100) * this.initScale);

      this.plumes2State.push({
        x: 0,
        y: 0,
        vx,
        vy,
        vch,
        vr,
        amp,
        a,
        time: 0,
        duree,
        alpha: 100,
        scale: t,
      });

      this.plumes2Entries.push({ sprite: particle.sprite, alive: true });
    }
  }

  private updatePlumesParticles(): void {
    // DefineSprite_7_plumes enterFrame:
    // if(time++ > duree) { _alpha -= 6.34; }
    // if(_Y < 0) { _Y += (vy += vch); _X += vx; vy *= 0.9; vx *= 0.9; amp *= 0.98; _rotation = amp * Math.sin(a += vr); }
    for (let i = 0; i < this.plumesState.length; i++) {
      const s = this.plumesState[i];
      const e = this.plumesEntries[i];
      if (!e || !e.alive) {
        continue;
      }

      if (s.time++ > s.duree) {
        s.alpha -= 6.34;
      }

      if (s.y < 0) {
        s.vy += s.vch;
        s.y += s.vy;
        s.x += s.vx;
        s.vy *= 0.9;
        s.vx *= 0.9;
        s.amp *= 0.98;
        const rotDeg = s.amp * Math.sin((s.a += s.vr));
        e.sprite.rotation = (rotDeg * Math.PI) / 180;
      }

      e.sprite.position.set(s.x, s.y);
      e.sprite.scale.set((s.scale / 100) * this.initScale);
      e.sprite.alpha = Math.max(0, s.alpha / 100);

      if (s.alpha <= 0) {
        e.alive = false;
        e.sprite.visible = false;
      }
    }
  }

  private updateFeuxParticles(): void {
    // DefineSprite_12_feux enterFrame:
    // _rotation = random(360);
    // t = 40 + random(80);
    // _xscale = t; _yscale = t;
    // _parent._y += g;
    // _alpha = 150 - (va += vacc);
    // _X = _X - (_X - d) / acc;
    // if(_alpha < 0) removeMovieClip()
    for (let i = 0; i < this.feuxState.length; i++) {
      const s = this.feuxState[i];
      const e = this.feuxEntries[i];
      if (!e || !e.alive || !s.alive) {
        continue;
      }

      const rotDeg = Math.floor(Math.random() * 360);
      s.t = 40 + Math.floor(Math.random() * 80);
      s.parentY += s.g;
      s.va += s.vacc;
      s.alpha = 150 - s.va;
      s.x = s.x - (s.x - s.d) / s.acc;

      e.sprite.rotation = (rotDeg * Math.PI) / 180;
      e.sprite.scale.set((s.t / 100) * this.initScale);
      e.sprite.position.set(s.x, s.parentY);
      e.sprite.alpha = Math.max(0, s.alpha / 100);

      if (s.alpha < 0) {
        s.alive = false;
        e.alive = false;
        e.sprite.visible = false;
      }
    }
  }

  private updatePlumes2Particles(): void {
    // DefineSprite_6_plumes2 enterFrame:
    // if(time++ > duree) { _alpha -= 3.34; }
    // if(_Y < 0) { _Y += (vy += vch); _X += vx; vy *= 0.9; vx *= 0.9; amp *= 0.98; _rotation = amp * Math.sin(a += vr); }
    for (let i = 0; i < this.plumes2State.length; i++) {
      const s = this.plumes2State[i];
      const e = this.plumes2Entries[i];
      if (!e || !e.alive) {
        continue;
      }

      if (s.time++ > s.duree) {
        s.alpha -= 3.34;
      }

      if (s.y < 0) {
        s.vy += s.vch;
        s.y += s.vy;
        s.x += s.vx;
        s.vy *= 0.9;
        s.vx *= 0.9;
        s.amp *= 0.98;
        const rotDeg = s.amp * Math.sin((s.a += s.vr));
        e.sprite.rotation = (rotDeg * Math.PI) / 180;
      }

      e.sprite.position.set(s.x, s.y);
      e.sprite.scale.set((s.scale / 100) * this.initScale);
      e.sprite.alpha = Math.max(0, s.alpha / 100);

      if (s.alpha <= 0) {
        e.alive = false;
        e.sprite.visible = false;
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    this.particleFrameAccum += deltaTime;
    let framesElapsed = 0;
    while (this.particleFrameAccum >= this.particleFrameTime) {
      this.particleFrameAccum -= this.particleFrameTime;
      framesElapsed++;
      this.shootFrameTracker++;
    }

    if (framesElapsed > 0) {
      if (this.plumesSpawned) {
        this.updatePlumesParticles();
      }
      if (this.feuxSpawned) {
        this.updateFeuxParticles();
      }
      if (this.plumes2Spawned) {
        this.updatePlumes2Particles();
      }
    }

    // Frame 289 (index 288) -> complete
    if (this.shootFrameTracker >= 288) {
      this.complete();
    }
  }

  destroy(): void {
    this.plumesParticles.destroy();
    this.feuxParticles.destroy();
    this.plumes2Particles.destroy();
    super.destroy();
  }
}
