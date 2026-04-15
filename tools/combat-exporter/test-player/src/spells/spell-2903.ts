/**
 * Spell 2903 - Fireworks
 *
 * A fireworks spell with a main rocket animation that launches and explodes.
 *
 * Components:
 * - Main rocket (DefineSprite_31): At target position, plays rocket launch
 *   then explosion with multiple `feux` (firework burst) sub-animations
 *   spawned at frame 76. Each `feux` instance itself spawns particle trails.
 *
 * Original AS timing (DefineSprite_31):
 * - Frame 1: Play sound 'fireworks01', set taille/scale/rotation
 * - Frame 70: Play sound 'explo_fireworks'
 * - Frame 76: Spawn 5 + 7*((level-1)%3) feux instances (sz scaled by level)
 * - Frame 97: stop()
 *
 * The `feux` symbol (DefineSprite_23) has multiple level-dependent sub-behaviors:
 * - Level 1 (frame 2): spinning/fading particle
 * - Level 2 (frame 3): (no additional script beyond stop)
 * - Level 3 (frame 5): rotating shrinking trail
 * - Level 4 (frame 8): spawns minifeux2 particles
 * - Level 5 (frame 11): spawns minifeux3 particles then removes
 * - Level 6 (frame 14): spawns minifeux4 then moves as projectile, spawns minifeux3
 *
 * Since feux uses `gotoAndStop(level + 1)` and each level frame has its own
 * physics clip, we replicate this by using the composite `feux` animation
 * frames directly (which already contain the composed frames from the SWF export),
 * and drive independent particle systems for each feux instance.
 *
 * Simplification: The composite `feux` animation exported in the manifest
 * already composites the sub-frame behaviors into 16 frames. We use those
 * directly, one FrameAnimatedSprite per feux instance. The minifeux/minifeux2/
 * minifeux3/minifeux4 sub-particles are driven as ASParticleSystems.
 *
 * Hit signal: at frame 69 (0-indexed) when explo_fireworks plays.
 * Complete: when main anim stops at frame 96 (0-indexed from AS frame 97).
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

// Manifests from manifest.json
const FEUX_MANIFEST: SpriteManifest = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

const MINIFEUX4_MANIFEST: SpriteManifest = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};

const MINIFEUX3_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX2_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

/**
 * Physics state for a single feux (firework burst) instance
 * Corresponds to DefineSprite_23_feux with level-dependent behavior.
 */
interface FeuxInstance {
  anim: FrameAnimatedSprite;
  /** Position of this feux on screen (world coords relative to container) */
  x: number;
  y: number;
  /** Which level frame this feux uses (2..7 in AS, i.e. level+1) */
  levelFrame: number;
  // Physics state (varies by levelFrame)
  g: number;
  va: number;
  t: number;
  vx: number;
  vy: number;
  accx: number;
  accy: number;
  vacc: number;
  acc: number;
  d: number;
  // For frame 14 behavior
  angle: number;
  vit: number;
  frein: number;
  vr: number;
  sz: number;
  frangle: number;
  // For frame 14: spawned minifeux4 tracers
  minifeux4Spawned: boolean;
  // Counter for minifeux3 spawn alpha
  c: number;
  // Whether this feux is still alive
  alive: boolean;
  removed: boolean;
}

export class Spell2903 extends BaseSpell {
  readonly spellId = 2903;

  private level = 1;
  private mainAnim!: FrameAnimatedSprite;
  private feuxContainer!: Container;
  private feuxInstances: FeuxInstance[] = [];

  // Particle systems for minifeux variants
  private minifeux4Particles!: ASParticleSystem;
  private minifeux3Particles!: ASParticleSystem;
  private minifeux2Particles!: ASParticleSystem;
  private minifeuxParticles!: ASParticleSystem;

  private textures!: SpellTextureProvider;
  private initCtx!: SpellInitContext;

  // Main animation frame counter (manual, since we need frame-level logic)
  private mainFrame = 0;
  private mainFrameAccum = 0;
  private readonly FRAME_TIME = 1000 / 60;
  private mainStopped = false;

  // Track which sounds have been played
  private sound0Played = false;
  private sound69Played = false;
  private feuxSpawned = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.textures = textures;
    this.initCtx = init;

    // Container for everything, positioned at target
    this.feuxContainer = new Container();
    this.feuxContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.feuxContainer);

    // Particle systems - positioned at target
    const mf4Tex = textures.getFrames('lib_minifeux4')[0];
    const mf3Tex = textures.getFrames('lib_minifeux3')[0];
    const mf2Tex = textures.getFrames('lib_minifeux2')[0];
    const mfTex = textures.getFrames('lib_minifeux')[0];

    this.minifeux4Particles = new ASParticleSystem(mf4Tex);
    this.minifeux3Particles = new ASParticleSystem(mf3Tex);
    this.minifeux2Particles = new ASParticleSystem(mf2Tex);
    this.minifeuxParticles = new ASParticleSystem(mfTex);

    this.feuxContainer.addChild(this.minifeux4Particles.container);
    this.feuxContainer.addChild(this.minifeux3Particles.container);
    this.feuxContainer.addChild(this.minifeux2Particles.container);
    this.feuxContainer.addChild(this.minifeuxParticles.container);

    // Main animation (DefineSprite_31) - uses the 'feux' frames as placeholder
    // The main timeline of DefineSprite_31 runs 97 frames.
    // We use a simple frame counter; the actual visual is driven by feux sub-sprites.
    // We need a visible animation for the rocket phase (frames 1-69).
    // The manifest's "minifeux4" composite (78 frames) is our closest analog for the
    // rocket, but actually DefineSprite_31 is the root container with 97 frames.
    // Since there's no dedicated rocket sprite exported, we drive timing manually
    // using mainFrame and spawn feux at frame 75 (0-indexed from AS frame 76).

    // Frame sound triggers based on main timeline
    // Frame 0 (AS frame 1): fireworks01
    // Frame 69 (AS frame 70): explo_fireworks, signalHit
    // Frame 75 (AS frame 76): spawn feux
    // Frame 96 (AS frame 97): stop
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Advance main timeline manually
    if (!this.mainStopped) {
      this.mainFrameAccum += deltaTime;
      while (this.mainFrameAccum >= this.FRAME_TIME && !this.mainStopped) {
        this.mainFrameAccum -= this.FRAME_TIME;
        this.onMainFrame(this.mainFrame);
        this.mainFrame++;
        if (this.mainFrame >= 97) {
          this.mainStopped = true;
        }
      }
    }

    // Update feux instances physics
    this.updateFeuxInstances(deltaTime);

    // Update particle systems
    this.minifeux4Particles.update();
    this.minifeux3Particles.update();
    this.minifeux2Particles.update();
    this.minifeuxParticles.update();

    // Update feux animations
    this.anims.update(deltaTime);

    // Check completion: main timeline stopped AND all particles gone AND all feux done
    if (this.mainStopped && !this.minifeux4Particles.hasAliveParticles() &&
        !this.minifeux3Particles.hasAliveParticles() &&
        !this.minifeux2Particles.hasAliveParticles() &&
        !this.minifeuxParticles.hasAliveParticles() &&
        this.feuxInstances.every(f => f.removed)) {
      this.complete();
    }
  }

  private onMainFrame(frame: number): void {
    // Frame 0 (AS frame 1): play fireworks01 sound
    if (frame === 0 && !this.sound0Played) {
      this.sound0Played = true;
      this.callbacks.playSound('fireworks01');
    }

    // Frame 69 (AS frame 70): play explo_fireworks + signalHit
    if (frame === 69 && !this.sound69Played) {
      this.sound69Played = true;
      this.callbacks.playSound('explo_fireworks');
      this.signalHit();
    }

    // Frame 75 (AS frame 76): spawn feux instances
    if (frame === 75 && !this.feuxSpawned) {
      this.feuxSpawned = true;
      this.spawnFeux();
    }
  }

  private spawnFeux(): void {
    // AS: sz = 60 + 20 * ((_parent._parent.level - 1) % 3)
    const sz = 60 + 20 * ((this.level - 1) % 3);
    // AS: i < 6 + 7 * ((_parent._parent.level - 1) % 3) → count = 5 + 7 * ((level-1)%3)
    const count = 5 + 7 * ((this.level - 1) % 3);

    // AS: _xscale = sz, _yscale = sz applied to the container of feux
    // level frame = gotoAndStop(_parent._parent._parent.level + 1)
    const levelFrame = this.level + 1; // AS 1-indexed frame, but we use as integer (2..7)

    const feuxAnchor = calculateAnchor(FEUX_MANIFEST);

    for (let i = 0; i < count; i++) {
      const feuxTextures = this.textures.getFrames('lib_feux');

      const anim = this.anims.add(new FrameAnimatedSprite({
        textures: feuxTextures,
        anchorX: feuxAnchor.x,
        anchorY: feuxAnchor.y,
        scale: this.initCtx.scale,
        loop: false,
      }));

      // Each feux has its own physics based on the levelFrame
      const instance = this.createFeuxInstance(anim, levelFrame, sz);
      this.feuxInstances.push(instance);
      this.feuxContainer.addChild(anim.sprite);

      // For frame 14 behavior (level 6), spawn minifeux4 immediately on load
      if (levelFrame === 14) {
        this.spawnMinifeux4At(instance.x, instance.y);
      }
    }
  }

  private createFeuxInstance(anim: FrameAnimatedSprite, levelFrame: number, sz: number): FeuxInstance {
    const instance: FeuxInstance = {
      anim,
      x: 0,
      y: 0,
      levelFrame,
      g: 0,
      va: 0,
      t: 0,
      vx: 0,
      vy: 0,
      accx: 1,
      accy: 1,
      vacc: 0,
      acc: 1,
      d: 0,
      angle: 0,
      vit: 0,
      frein: 0.9,
      vr: 0,
      sz: sz,
      frangle: 1.2,
      minifeux4Spawned: false,
      c: 0,
      alive: true,
      removed: false,
    };

    // Initialize physics per levelFrame (AS onClipEvent(load))
    if (levelFrame === 2) {
      // DefineSprite_23_feux/frame_2
      // _parent._rotation = random(360); applied to parent container rotation
      const parentRotation = Math.floor(Math.random() * 360);
      anim.sprite.rotation = (parentRotation * Math.PI) / 180;
      // vg = -6 * Math.random(); g = 1 * Math.random();
      instance.g = 1 * Math.random();
      // va = 0;
      instance.va = 0;
      // t = 100 + random(100);
      instance.t = 100 + Math.floor(Math.random() * 100);
      anim.sprite.scale.set(instance.t / 100 * this.initCtx.scale);
      // _X = 10 + random(20); d = dmax - random(70);
      instance.x = 10 + Math.floor(Math.random() * 20);
      instance.d = 100 - Math.floor(Math.random() * 70);
      // acc = 3.34 + Math.random() * 5;
      instance.acc = 3.34 + Math.random() * 5;
      // vacc = 1 + 1 * Math.random();
      instance.vacc = 1 + 1 * Math.random();
      anim.sprite.position.set(instance.x, instance.y);
    } else if (levelFrame === 5) {
      // DefineSprite_23_feux/frame_5
      const parentRotation = Math.floor(Math.random() * 360);
      anim.sprite.rotation = (parentRotation * Math.PI) / 180;
      instance.g = 0.6 * Math.random();
      instance.va = 0;
      instance.t = 200 + Math.floor(Math.random() * 100);
      anim.sprite.scale.set(instance.t / 100 * this.initCtx.scale);
      instance.x = 10 + Math.floor(Math.random() * 20);
      instance.d = 100 - Math.floor(Math.random() * 70);
      instance.acc = 1.67 + Math.random() * 5;
      instance.vacc = 1 + 1 * Math.random();
      anim.sprite.position.set(instance.x, instance.y);
    } else if (levelFrame === 8) {
      // DefineSprite_23_feux/frame_8
      instance.g = 0.67 * Math.random();
      instance.va = 0;
      instance.t = 100 + Math.floor(Math.random() * 100);
      anim.sprite.scale.set(instance.t / 100 * this.initCtx.scale);
      instance.d = 100 - Math.floor(Math.random() * 70);
      instance.acc = 1.67 + Math.random() * 5;
      instance.vacc = 1 + 1 * Math.random();
      instance.vx = 10 * (-0.5 + Math.random());
      instance.vy = 10 * (-0.5 + Math.random());
      instance.accx = 0.8 + 0.1 * Math.random();
      instance.accy = 0.8 + 0.1 * Math.random();
      instance.c = 0;
      anim.sprite.position.set(instance.x, instance.y);
    } else if (levelFrame === 11) {
      // DefineSprite_23_feux/frame_11
      instance.g = 0.67 * Math.random();
      instance.va = 0;
      instance.t = 100 + Math.floor(Math.random() * 100);
      anim.sprite.scale.set(instance.t / 100 * this.initCtx.scale);
      instance.x = -10 + Math.floor(Math.random() * 20);
      instance.d = 100 - Math.floor(Math.random() * 70);
      instance.acc = 1.67 + Math.random() * 5;
      instance.vacc = 1.5 + 1.5 * Math.random();
      instance.vx = 20 * (-0.5 + Math.random());
      instance.vy = 20 * (-0.5 + Math.random());
      instance.accx = 0.8 + 0.1 * Math.random();
      instance.accy = 0.8 + 0.1 * Math.random();
      instance.c = 0;
      anim.sprite.position.set(instance.x, instance.y);
    } else if (levelFrame === 14) {
      // DefineSprite_23_feux/frame_14
      instance.angle = -1.1415 + 0.2 * (-0.5 + Math.random());
      instance.vit = 2 + 10 * Math.random();
      instance.frein = 0.9 + 0.05 * Math.random();
      instance.vr = 0;
      instance.sz = 240 + Math.floor(Math.random() * 120);
      instance.frangle = 1.2;
      anim.sprite.rotation = instance.angle;
      anim.sprite.alpha = (50 + Math.floor(Math.random() * 60)) / 100;
      const scaleFactor = instance.sz / 100 * this.initCtx.scale;
      anim.sprite.scale.set(scaleFactor);
      anim.sprite.position.set(instance.x, instance.y);
    } else {
      // Fallback / frames 3, 4, 6, 7 etc. - just animate normally
      anim.sprite.position.set(0, 0);
    }

    return instance;
  }

  private updateFeuxInstances(deltaTime: number): void {
    // We process feux physics at 60fps (one tick per frame)
    // Since deltaTime is in ms, we accumulate per-feux but for simplicity
    // update each feux once per update call scaled to 60fps equivalent.
    // Each feux uses a per-frame accumulator approach:
    const tickCount = Math.floor(deltaTime / this.FRAME_TIME + 0.5);
    const ticks = Math.max(1, tickCount);

    for (const inst of this.feuxInstances) {
      if (inst.removed) {
        continue;
      }

      for (let tick = 0; tick < ticks; tick++) {
        this.tickFeuxInstance(inst);
        if (inst.removed) {
          break;
        }
      }
    }
  }

  private tickFeuxInstance(inst: FeuxInstance): void {
    if (inst.removed) {
      return;
    }

    const lf = inst.levelFrame;

    if (lf === 2) {
      // frame_2 enterFrame
      inst.anim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;
      const tLocal = 20 + Math.floor(Math.random() * 80);
      inst.anim.sprite.scale.set(tLocal / 100 * this.initCtx.scale);
      // _parent._y += g  (move the container's y)
      inst.y += inst.g;
      // _alpha = 150 - (va += vacc)
      inst.va += inst.vacc;
      inst.anim.sprite.alpha = Math.max(0, (150 - inst.va) / 100);
      // _X = _X - (_X - d) / acc
      inst.x = inst.x - (inst.x - inst.d) / inst.acc;
      inst.anim.sprite.position.set(inst.x, inst.y);

      if (inst.anim.sprite.alpha <= 0) {
        inst.anim.sprite.visible = false;
        inst.removed = true;
      }
    } else if (lf === 5) {
      // frame_5 enterFrame
      inst.anim.sprite.rotation += (inst.t / 6) * (Math.PI / 180);
      inst.t--;
      inst.anim.sprite.scale.set((inst.t / 3) / 100 * this.initCtx.scale);
      inst.y += inst.g;
      inst.x = inst.x - (inst.x - inst.d) / inst.acc;
      inst.anim.sprite.position.set(inst.x, inst.y);

      if (inst.t < 0) {
        inst.anim.sprite.visible = false;
        inst.removed = true;
      }
    } else if (lf === 8) {
      // frame_8 enterFrame
      // if(random(15) == 1) spawn minifeux2
      if (Math.floor(Math.random() * 15) === 1) {
        this.spawnMinifeux2At(inst.x, inst.y + inst.y);
        inst.c++;
      }
      inst.anim.sprite.rotation += (inst.t / 3) * (Math.PI / 180);
      inst.t--;
      inst.anim.sprite.scale.set((inst.t / 3) / 100 * this.initCtx.scale);
      inst.y += inst.g;
      inst.vx *= inst.accx;
      inst.vy *= inst.accy;
      inst.x += inst.vx;
      inst.y += inst.vy;
      inst.anim.sprite.position.set(inst.x, inst.y);

      if (inst.t < 0) {
        inst.anim.sprite.visible = false;
        inst.removed = true;
      }
    } else if (lf === 11) {
      // frame_11 enterFrame
      // if(t < 150) play() - the feux anim plays
      // if(t < 135) spawn minifeux3 x9, removeMovieClip
      if (inst.t < 135) {
        // spawn 9 minifeux3 particles
        for (let nbr = 1; nbr < 10; nbr++) {
          this.spawnMinifeux3At(inst.x, inst.y, (100 - inst.c) / 100);
          inst.c++;
        }
        inst.anim.sprite.visible = false;
        inst.removed = true;
        return;
      }
      inst.anim.sprite.rotation += (inst.t / 3) * (Math.PI / 180);
      inst.t--;
      inst.anim.sprite.scale.set((inst.t / 3) / 100 * this.initCtx.scale);
      inst.y += inst.g;
      inst.vx *= inst.accx;
      inst.vy *= inst.accy;
      inst.x += inst.vx;
      inst.y += inst.vy;
      inst.anim.sprite.position.set(inst.x, inst.y);
    } else if (lf === 14) {
      // frame_14 enterFrame
      inst.anim.sprite.rotation = inst.angle;
      inst.anim.sprite.alpha = (50 + Math.floor(Math.random() * 60)) / 100;
      inst.sz *= inst.frein + 0.02;
      inst.anim.sprite.scale.set(inst.sz / 100 * this.initCtx.scale);

      if (Math.floor(Math.random() * 24) === 1) {
        inst.vr = 0.67 * (-0.5 + Math.random());
      }
      inst.angle += inst.vr * inst.frangle;
      inst.frangle *= inst.frein;

      const vx = inst.vit * Math.cos(inst.angle);
      const vy = inst.vit * Math.sin(inst.angle);
      inst.x += vx;
      inst.y += vy;
      inst.vit *= inst.frein;

      inst.anim.sprite.position.set(inst.x, inst.y);

      // if(t < 150) play() -- t is never set on frame_14 instance, it remains 0
      // if(t < 135) spawn minifeux3 x9, removeMovieClip
      if (inst.t < 135) {
        for (let nbr = 1; nbr < 10; nbr++) {
          this.spawnMinifeux3At(inst.x, inst.y, (100 - inst.c) / 100);
          inst.c++;
        }
        inst.anim.sprite.visible = false;
        inst.removed = true;
      }
    }
  }

  private spawnMinifeux4At(x: number, y: number): void {
    const anchor = calculateAnchor(MINIFEUX4_MANIFEST);
    // DefineSprite_3_minifeux4 onClipEvent(load):
    // angle = 90; _alpha = random(150); v = -1.6 - 3.34 * Math.random(); vr = -0.5 + Math.random();
    const alphaVal = Math.floor(Math.random() * 150) / 100;
    const v = -1.6 - 3.34 * Math.random();
    const vr = -0.5 + Math.random();
    const angle = 90; // degrees

    this.minifeux4Particles.spawn({
      x,
      y,
      vx: v * Math.cos(angle * Math.PI / 180),
      vy: v * Math.sin(angle * Math.PI / 180),
      accX: 0.85,
      accY: 0.85,
      vr,
      vrDecay: 1.0, // vr doesn't decay in AS - it's added directly each frame
      t: alphaVal * 100,
      vt: -1.6, // _alpha -= 1.6 per frame
      vtDecay: 0,
      rotation: angle * 57.29746936176985,
      alpha: alphaVal,
      alphaVelocity: -1.6 / 100,
    });

    void anchor; // suppress unused warning
  }

  private spawnMinifeux3At(x: number, y: number, alpha: number): void {
    // DefineSprite_6_minifeux3 onClipEvent(load):
    // _alpha = random(150); v = 0.67 + 1 * Math.random();
    const initAlpha = Math.floor(Math.random() * 150) / 100;
    const v = 0.67 + 1 * Math.random();
    const rotation = Math.floor(Math.random() * 360);

    this.minifeux3Particles.spawn({
      x,
      y,
      vx: v,
      vy: 0,
      accX: 0.85,
      accY: 1,
      vr: 0,
      vrDecay: 1,
      t: initAlpha * 100,
      vt: -1.6,
      vtDecay: 0,
      rotation,
      alpha: Math.min(initAlpha, alpha),
      alphaVelocity: -1.6 / 100,
    });
  }

  private spawnMinifeux2At(x: number, y: number): void {
    // DefineSprite_7_minifeux2 onClipEvent(load):
    // _alpha = random(150); v = Math.random();
    const initAlpha = Math.floor(Math.random() * 150) / 100;
    const v = Math.random();
    const rotation = Math.floor(Math.random() * 360);

    this.minifeux2Particles.spawn({
      x,
      y,
      vx: v,
      vy: 0,
      accX: 1,
      accY: 1,
      vr: 0,
      vrDecay: 1,
      t: initAlpha * 100,
      vt: -3.34,
      vtDecay: 0,
      rotation,
      alpha: initAlpha,
      alphaVelocity: -3.34 / 100,
    });
  }

  private spawnMinifeuxAt(x: number, y: number): void {
    // DefineSprite_8_minifeux onClipEvent(load):
    // _alpha = 150; v = Math.random();
    const initAlpha = 150 / 100;
    const v = Math.random();
    const rotation = Math.floor(Math.random() * 360);

    this.minifeuxParticles.spawn({
      x,
      y,
      vx: v,
      vy: 0,
      accX: 1,
      accY: 1,
      vr: 0,
      vrDecay: 1,
      t: initAlpha * 100,
      vt: -3.34,
      vtDecay: 0,
      rotation,
      alpha: initAlpha,
      alphaVelocity: -3.34 / 100,
    });
  }

  destroy(): void {
    this.minifeux4Particles.destroy();
    this.minifeux3Particles.destroy();
    this.minifeux2Particles.destroy();
    this.minifeuxParticles.destroy();
    super.destroy();
  }
}
