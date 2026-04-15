/**
 * Spell 2904 - Feux d'artifice (Fireworks)
 *
 * A fireworks spell with multiple fire particle effects.
 *
 * Components:
 * - Main animation (DefineSprite_45): The main fireworks animation at target position
 *   - Frame 1: Play sound 'fireworks01', set random scale (80-120%) and rotation (-20 to +20)
 *   - Frame 70: Play sound 'explo_fireworks' -> signal hit
 *   - Frame 76: Spawn feux burst instances (count based on level)
 *   - Frame 97: stop()
 *
 * - feux instances (DefineSprite_37_feux): Individual firework burst particles
 *   Each feux instance chooses a behavior based on level (frame 1 DoAction: gotoAndStop(level+1))
 *   The feux instances themselves spawn minifeux2, minifeux3, minifeux4 sub-particles
 *
 * Original AS timing (DefineSprite_45):
 * - Frame 1: playSound('fireworks01'), set scale/rotation
 * - Frame 70: playSound('explo_fireworks') -> signalHit
 * - Frame 76: attachMovie("feux") x (5 + 7*((level-1)%3)) instances, scaled sz = 60+20*((level-1)%3)
 * - Frame 97: stop()
 *
 * The feux sub-particles are implemented using FrameAnimatedSprite with the
 * 'feux' animation. Each feux instance uses a random starting frame based on
 * its internal level logic. The complex sub-particle spawning (minifeux2/3/4)
 * is approximated by just playing out the feux animations since the sub-particles
 * are tiny decorative embers that the animation sprites already represent visually.
 *
 * Since the minifeux* sprites ARE the sub-particles (they are the full composite
 * animations already rendered), we spawn those directly as FrameAnimatedSprites
 * with randomized positions and parameters matching the AS code.
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

// Manifests from manifest.json
const FEUX_MANIFEST: SpriteManifest = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

const MINIFEUX_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX4_MANIFEST: SpriteManifest = {
  width: 2.7,
  height: 3.2,
  offsetX: -0.15,
  offsetY: -1.55,
};

// Physics state for dynamically-positioned feux instances
interface FeuxInstance {
  anim: FrameAnimatedSprite;
  // Physics for the feux container itself
  x: number;
  y: number;
  vx: number;
  vy: number;
  accx: number;
  accy: number;
  g: number;
  t: number;
  angle: number;
  vit: number;
  frein: number;
  vr: number;
  frangle: number;
  sz: number;
  // Which frame behavior (2..8, driven by level)
  behaviorFrame: number;
  active: boolean;
}

// A tiny sub-particle (minifeux, minifeux2, minifeux3, minifeux4)
interface MiniParticle {
  anim: FrameAnimatedSprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  accx: number;
  accy: number;
  v: number; // for minifeux/minifeux2 (drift velocity)
  alpha: number;
  alphaDecay: number;
  active: boolean;
  // minifeux3/minifeux4 specific
  angle?: number;
  vr?: number;
  isMini4?: boolean;
  isMini3?: boolean;
}

export class Spell2904 extends BaseSpell {
  readonly spellId = 2904;

  // Main animation timeline container (DefineSprite_45)
  private mainAnim!: FrameAnimatedSprite;
  private mainContainer!: Container;

  // Feux burst instances (spawned at main frame 76)
  private feuxInstances: FeuxInstance[] = [];
  private feuxContainer!: Container;

  // Sub-particles (minifeux, minifeux2, minifeux3, minifeux4)
  private miniParticles: MiniParticle[] = [];
  private miniContainer!: Container;

  // Cached textures
  private feuxTextures: ReturnType<SpellTextureProvider["getFrames"]> = [];
  private minifeux3Textures: ReturnType<SpellTextureProvider["getFrames"]> = [];
  private minifeux2Textures: ReturnType<SpellTextureProvider["getFrames"]> = [];
  private minifeux4Textures: ReturnType<SpellTextureProvider["getFrames"]> = [];

  private level = 1;
  private targetX = 0;
  private targetY = 0;

  // Main animation scale and rotation (set at frame 1)
  private mainScale = 1;
  private mainRotation = 0;

  // Frame counter for main timeline
  private mainFrame = 0;
  private mainFrameAccum = 0;
  private readonly FRAME_TIME = 1000 / 60;
  private mainStopped = false;

  // Feux burst spawn params (computed at frame 76)
  private feuxCount = 0;
  private feuxSz = 60;
  private feuxSpawned = false;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.targetX = init.targetX;
    this.targetY = init.targetY;

    // Cache textures
    this.feuxTextures = textures.getFrames("feux");
    this.minifeux3Textures = textures.getFrames("minifeux3");
    this.minifeux2Textures = textures.getFrames("minifeux2");
    this.minifeux4Textures = textures.getFrames("minifeux4");

    // Create containers
    this.miniContainer = new Container();
    this.miniContainer.position.set(this.targetX, this.targetY);
    this.container.addChild(this.miniContainer);

    this.feuxContainer = new Container();
    this.feuxContainer.position.set(this.targetX, this.targetY);
    this.container.addChild(this.feuxContainer);

    // Main container for the primary animation
    this.mainContainer = new Container();
    this.mainContainer.position.set(this.targetX, this.targetY);
    this.container.addChild(this.mainContainer);

    // Compute main scale and rotation (AS frame_1 DoAction_2):
    // taille = 80 + random(40); _xscale = taille; _yscale = taille;
    // _rotation = -20 + random(40);
    const taille = 80 + Math.floor(Math.random() * 40);
    this.mainScale = taille / 100;
    this.mainRotation =
      (-20 + Math.floor(Math.random() * 40)) * (Math.PI / 180);

    // Create the main animation (feux animation plays the main firework arc)
    // DefineSprite_45 is the outer shell - it uses the 'feux' animation internally
    // but for simplicity we use the pre-rendered 'feux' composite animation
    // The main animation here represents the rocket/trail phase (frames 1-69)
    // then the explosion phase starts at frame 70
    // We use a FrameAnimatedSprite for the main feux animation
    const feuxAnchor = calculateAnchor(FEUX_MANIFEST);
    this.mainAnim = new FrameAnimatedSprite({
      textures: this.feuxTextures,
      anchorX: feuxAnchor.x,
      anchorY: feuxAnchor.y,
      scale: this.mainScale * init.scale,
      loop: true,
    });
    this.mainAnim.sprite.rotation = this.mainRotation;
    this.mainContainer.addChild(this.mainAnim.sprite);

    // Play sound at frame 1 (frame 0 in 0-indexed) - fireworks01
    this.callbacks.playSound("fireworks01");
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Advance main frame counter manually
    if (!this.mainStopped) {
      this.mainFrameAccum += deltaTime;
      while (this.mainFrameAccum >= this.FRAME_TIME) {
        this.mainFrameAccum -= this.FRAME_TIME;
        this.mainFrame++;

        // Frame 69 (AS frame 70): play explo_fireworks, signal hit
        if (this.mainFrame === 69) {
          this.callbacks.playSound("explo_fireworks");
          this.signalHit();
        }

        // Frame 75 (AS frame 76): spawn feux burst
        if (this.mainFrame === 75 && !this.feuxSpawned) {
          this.feuxSpawned = true;
          this.spawnFeuxBurst();
          // Hide main anim after explosion starts
          this.mainAnim.sprite.visible = false;
        }

        // Frame 96 (AS frame 97): stop
        if (this.mainFrame >= 96) {
          this.mainStopped = true;
          break;
        }
      }
    }

    // Update main animation sprite frames
    this.mainAnim.update(deltaTime);

    // Update feux instances
    for (const feux of this.feuxInstances) {
      if (!feux.active) {
        continue;
      }
      this.updateFeuxInstance(feux, deltaTime);
    }

    // Update mini particles
    for (const mp of this.miniParticles) {
      if (!mp.active) {
        continue;
      }
      this.updateMiniParticle(mp);
    }

    // Check completion: main stopped AND no active feux AND no active mini particles
    if (this.mainStopped && this.feuxSpawned) {
      const anyActiveFeux = this.feuxInstances.some((f) => f.active);
      const anyActiveMini = this.miniParticles.some((m) => m.active);
      if (!anyActiveFeux && !anyActiveMini) {
        this.complete();
      }
    }
  }

  private spawnFeuxBurst(): void {
    // AS frame_76 onClipEvent(load):
    // sz = 60 + 20 * ((_parent._parent.level - 1) % 3)
    // i = 1; while(i < 6 + 7 * ((_parent._parent.level - 1) % 3)) { attachMovie("feux", ...) }
    const levelMod = (this.level - 1) % 3;
    this.feuxSz = 60 + 20 * levelMod;
    this.feuxCount = 5 + 7 * levelMod; // while(i < 6 + 7*...) starting from i=1 -> 5+7*levelMod instances

    const feuxAnchor = calculateAnchor(FEUX_MANIFEST);

    for (let i = 0; i < this.feuxCount; i++) {
      // Each feux uses gotoAndStop(level + 1) -> but since we can't easily replicate the
      // internal feux behavior with sub-sprites, we model each as a physics entity
      // using the behavior from the AS scripts.
      // The feux sprite picks a frame based on level: gotoAndStop(_parent._parent._parent.level + 1)
      // level 1 -> frame 2, level 2 -> frame 3, etc.
      // We use the 'feux' animation for visuals

      const startFrame = Math.min(this.level, this.feuxTextures.length - 1);

      const anim = new FrameAnimatedSprite({
        textures: this.feuxTextures,
        anchorX: feuxAnchor.x,
        anchorY: feuxAnchor.y,
        startFrame,
        loop: false,
      });

      // Apply the burst scale
      const scale = this.feuxSz / 100;
      anim.sprite.scale.set(scale);

      // Physics based on AS frame behaviors.
      // We blend behaviors from frame_5 (level 4 or mid-level) as the general case
      // since most feux use similar bounce/drift physics.
      // Using frame_5 physics (the spinning drift type):
      // _parent._rotation = random(360)
      // t = 200 + random(100); g = 0.6 * random; acc = 1.67 + random*5
      // _X = 10 + random(20); d = dmax - random(70)

      const rotation = Math.floor(Math.random() * 360) * (Math.PI / 180);
      anim.sprite.rotation = rotation;

      // Random initial position spread
      const spreadX = (Math.random() - 0.5) * 60;
      const spreadY = (Math.random() - 0.5) * 40;
      anim.sprite.position.set(spreadX, spreadY);

      this.feuxContainer.addChild(anim.sprite);

      // Physics state modeled on frame_5 behavior (spinning + drift toward target)
      const g = 0.6 * Math.random();
      const t = 200 + Math.floor(Math.random() * 100);
      const _d = 100 - Math.floor(Math.random() * 70);
      const _acc = 1.67 + Math.random() * 5;
      const _x = 10 + Math.floor(Math.random() * 20);

      // For level 8 frame (frame_14 - the bouncing one): use angle-based velocity
      // For simplicity we use a unified physics model across all feux
      const angle = -1.1415 + 0.2 * (-0.5 + Math.random());
      const vit = 2 + 10 * Math.random();
      const frein = 0.9 + 0.05 * Math.random();
      const sz = 240 + Math.floor(Math.random() * 120);

      const feuxInst: FeuxInstance = {
        anim,
        x: spreadX,
        y: spreadY,
        vx: 0,
        vy: 0,
        accx: 0.8 + 0.1 * Math.random(),
        accy: 0.8 + 0.1 * Math.random(),
        g,
        t,
        angle,
        vit,
        frein,
        vr: 0,
        frangle: 1.2,
        sz,
        behaviorFrame: this.level + 1,
        active: true,
      };

      // Override vx/vy for the drift-type behaviors (frame 5 style uses _X approach)
      // But frame_8/frame_11 use vx/vy directly. Use mixed approach:
      feuxInst.vx = 10 * (-0.5 + Math.random());
      feuxInst.vy = 10 * (-0.5 + Math.random());

      this.feuxInstances.push(feuxInst);

      // Each feux also spawns minifeux4 at load time (frame_14 behavior):
      // nbr=1; while(nbr < 2) -> 1 minifeux4 spawned
      this.spawnMinifeux4(spreadX, spreadY);
    }
  }

  private updateFeuxInstance(feux: FeuxInstance, deltaTime: number): void {
    feux.anim.update(deltaTime);

    // Physics update (per-frame, using FRAME_TIME accumulation approximation)
    // Simplified: update each call (assumes ~60fps)
    feux.t--;

    // Rotation animation: _rotation += t/3
    feux.anim.sprite.rotation += (feux.t / 3) * (Math.PI / 180);

    // Scale: _xscale = t/3; _yscale = t/3
    const scaleVal = Math.max(0, feux.t / 3) / 100;
    feux.anim.sprite.scale.set(scaleVal);

    // Y drift: _parent._y += g
    feux.y += feux.g;

    // Position update: _X += (vx *= accx); _Y += (vy *= accy)
    feux.vx *= feux.accx;
    feux.vy *= feux.accy;
    feux.x += feux.vx;
    feux.y += feux.vy;

    feux.anim.sprite.position.set(feux.x, feux.y);

    // Spawn minifeux3 particles when t < 135 (frame_11 behavior)
    if (feux.t < 135) {
      // AS: nbr=1; while(nbr < 10) -> spawn 9 minifeux3
      for (let nbr = 1; nbr < 10; nbr++) {
        this.spawnMinifeux3(feux.x, feux.y);
      }
      feux.active = false;
      feux.anim.sprite.visible = false;
      return;
    }

    // Randomly spawn minifeux2 (frame_8 behavior: if(random(15) == 1))
    if (Math.floor(Math.random() * 15) === 1) {
      this.spawnMinifeux2(feux.x, feux.y);
    }

    // Death condition
    if (feux.t < 0) {
      feux.active = false;
      feux.anim.sprite.visible = false;
    }
  }

  private spawnMinifeux3(x: number, y: number): void {
    if (this.minifeux3Textures.length === 0) {
      return;
    }

    const anchor = calculateAnchor(MINIFEUX_MANIFEST);
    const anim = new FrameAnimatedSprite({
      textures: this.minifeux3Textures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      loop: false,
    });

    // DefineSprite_6_minifeux3/frame_1/DoAction: _rotation = random(360)
    anim.sprite.rotation = Math.floor(Math.random() * 360) * (Math.PI / 180);
    anim.sprite.position.set(x, y);

    // frame_1 load: _alpha = random(150); v = 0.67 + 1 * Math.random()
    const alpha = Math.floor(Math.random() * 150) / 100;
    anim.sprite.alpha = Math.min(1, alpha);

    this.miniContainer.addChild(anim.sprite);

    const mp: MiniParticle = {
      anim,
      x,
      y,
      vx: 0,
      vy: 0,
      accx: 0.85,
      accy: 1,
      v: 0.67 + 1 * Math.random(),
      alpha: Math.floor(Math.random() * 150),
      alphaDecay: 1.6,
      active: true,
      isMini3: true,
    };

    this.miniParticles.push(mp);
  }

  private spawnMinifeux2(x: number, y: number): void {
    if (this.minifeux2Textures.length === 0) {
      return;
    }

    const anchor = calculateAnchor(MINIFEUX_MANIFEST);
    const anim = new FrameAnimatedSprite({
      textures: this.minifeux2Textures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      loop: false,
    });

    // DefineSprite_7_minifeux2/frame_1/DoAction: _rotation = random(360)
    anim.sprite.rotation = Math.floor(Math.random() * 360) * (Math.PI / 180);
    anim.sprite.position.set(x, y);

    // frame_1 load: _alpha = random(150); v = Math.random()
    const alpha = Math.floor(Math.random() * 150);
    anim.sprite.alpha = Math.min(1, alpha / 100);

    this.miniContainer.addChild(anim.sprite);

    const mp: MiniParticle = {
      anim,
      x,
      y,
      vx: 0,
      vy: 0,
      accx: 1,
      accy: 1,
      v: Math.random(),
      alpha,
      alphaDecay: 3.34,
      active: true,
    };

    this.miniParticles.push(mp);
  }

  private spawnMinifeux4(x: number, y: number): void {
    if (this.minifeux4Textures.length === 0) {
      return;
    }

    const anchor = calculateAnchor(MINIFEUX4_MANIFEST);
    const anim = new FrameAnimatedSprite({
      textures: this.minifeux4Textures,
      anchorX: anchor.x,
      anchorY: anchor.y,
      loop: false,
    });

    // DefineSprite_3_minifeux4/frame_1/PlaceObject2_2_1 onClipEvent(load):
    // angle = 90; _alpha = random(150); v = -1.6 - 3.34 * Math.random(); vr = -0.5 + Math.random()
    const alpha = Math.floor(Math.random() * 150);
    anim.sprite.alpha = Math.min(1, alpha / 100);
    anim.sprite.position.set(x, y);

    this.miniContainer.addChild(anim.sprite);

    const mp: MiniParticle = {
      anim,
      x,
      y,
      vx: 0,
      vy: 0,
      accx: 1,
      accy: 1,
      v: -1.6 - 3.34 * Math.random(),
      alpha,
      alphaDecay: 1.6,
      active: true,
      isMini4: true,
      angle: 90,
      vr: -0.5 + Math.random(),
    };

    this.miniParticles.push(mp);
  }

  private updateMiniParticle(mp: MiniParticle): void {
    // Update animation frames
    mp.anim.update(this.FRAME_TIME);

    if (mp.isMini4) {
      // DefineSprite_3_minifeux4 enterFrame:
      // _rotation = angle * 57.29746936176985
      // angle += vr
      // _parent._alpha = random(100) (parent alpha flicker - skip for simplicity)
      // _alpha = _alpha - 1.6
      // _Y += (v *= 0.85)
      // vx = v * cos(angle); vy = v * sin(angle)
      // _X += vx; _Y += vy
      const angle = mp.angle ?? 90;
      mp.anim.sprite.rotation = angle * (Math.PI / 180);
      mp.angle = angle + (mp.vr ?? 0);

      mp.alpha -= 1.6;
      mp.v *= 0.85;
      mp.y += mp.v;
      const vx = mp.v * Math.cos(angle);
      const vy = mp.v * Math.sin(angle);
      mp.x += vx;
      mp.y += vy;

      mp.anim.sprite.position.set(mp.x, mp.y);
      mp.anim.sprite.alpha = Math.max(0, mp.alpha / 100);

      // removeMovieClip at frame 76 (0-indexed: 75)
      if (mp.anim.getFrame() >= 75) {
        mp.active = false;
        mp.anim.sprite.visible = false;
        return;
      }
    } else if (mp.isMini3) {
      // DefineSprite_6_minifeux3 enterFrame:
      // _parent._alpha = random(100) (skip)
      // _alpha = _alpha - 1.6
      // _X += (v *= 0.85)
      mp.alpha -= 1.6;
      mp.v *= 0.85;
      mp.x += mp.v;

      mp.anim.sprite.position.set(mp.x, mp.y);
      mp.anim.sprite.alpha = Math.max(0, mp.alpha / 100);

      // removeMovieClip at frame 76 (0-indexed: 75)
      if (mp.anim.getFrame() >= 75) {
        mp.active = false;
        mp.anim.sprite.visible = false;
        return;
      }
    } else {
      // minifeux / minifeux2 enterFrame:
      // _alpha = _alpha - 3.34
      // _X += v
      mp.alpha -= 3.34;
      mp.x += mp.v;

      mp.anim.sprite.position.set(mp.x, mp.y);
      mp.anim.sprite.alpha = Math.max(0, mp.alpha / 100);

      // removeMovieClip at frame 34 (0-indexed: 33)
      if (mp.anim.getFrame() >= 33) {
        mp.active = false;
        mp.anim.sprite.visible = false;
        return;
      }
    }

    if (mp.alpha <= 0) {
      mp.active = false;
      mp.anim.sprite.visible = false;
    }
  }

  override destroy(): void {
    // Clean up mini particle sprites not registered with this.anims
    for (const mp of this.miniParticles) {
      mp.anim.destroy();
    }
    this.miniParticles = [];

    // Clean up feux instance sprites not registered with this.anims
    for (const feux of this.feuxInstances) {
      feux.anim.destroy();
    }
    this.feuxInstances = [];

    // Destroy main anim (registered in anims manager via setup)
    super.destroy();
  }
}
