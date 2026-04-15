/**
 * Spell 305 - Séisme (Sacrieur)
 *
 * A ground-shaking spell with rock particles and trailing circle effects.
 *
 * Components:
 * - shoot (sprite): Main animation at target position, 159 frames
 *   - Rock particles (pierres): 5 instances spawned at load, with physics
 *   - Oscillating child sprite: rotation oscillation dampening
 *   - Move tracker: spawns cercle trail particles
 *   - Fade-out: alpha decreases from frame 130
 * - pierres particles: rocks with gravity, bounce, random scale/alpha
 * - cercle particles: trailing ring effects with velocity decay
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'setag_305'
 * - Frame 1 (shoot): Play sound 'setag_310'
 * - Frame 1 (shoot): Attach 5 pierres particles
 * - Frame 130 (shoot): Begin alpha fade (-5 per frame)
 * - Frame 157 (shoot): removeMovieClip / stop
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 108.75,
  height: 67.5,
  offsetX: -43.6,
  offsetY: -63.4,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

const CERCLE_MANIFEST: SpriteManifest = {
  width: 44.2,
  height: 18.6,
  offsetX: -19.55,
  offsetY: -17.1,
};

/**
 * Pierres (rock) particle - has bounce physics
 */
interface PierreParticle {
  container: Container;
  spriteAnim: FrameAnimatedSprite;
  // Container position (parent._x, parent._y in AS)
  cx: number;
  cy: number;
  // Velocity for container movement
  vx: number;
  vy: number;
  // Internal _Y within container (the bounce height)
  localY: number;
  // Vertical velocity
  v: number;
  // Rotation velocity
  vr: number;
  // Current rotation
  rotation: number;
  // Scale percentage
  t: number;
  // Alpha (0-100)
  alpha: number;
  // Settled flag
  settled: boolean;
  alive: boolean;
}

/**
 * Cercle (circle trail) particle
 */
interface CercleParticle {
  spriteAnim: FrameAnimatedSprite;
  // Position
  x: number;
  y: number;
  // Velocity
  vx: number;
  vy: number;
  // Alpha (0-100 scale)
  alpha: number;
  // Alpha decay per frame
  va: number;
  // Velocity decay factor
  r: number;
  alive: boolean;
}

export class Spell305 extends BaseSpell {
  readonly spellId = 305;

  private shootAnim!: FrameAnimatedSprite;
  private shootContainer!: Container;

  // Pierres (rock) particles
  private pierres: PierreParticle[] = [];
  private pierresContainer!: Container;

  // Cercle (circle) trail particles
  private cercles: CercleParticle[] = [];
  private cerclesContainer!: Container;

  // Alpha fade state for shoot (starts at frame 130)
  private shootAlpha = 100;
  private fading = false;

  // Pierres textures/manifest stored for particle creation
  private pierresTextures: Texture[] = [];
  private cercleTextures: Texture[] = [];

  // Cached scale for particle spawning
  private cachedScale = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.cachedScale = init.scale;

    // Play main sound at frame 1
    this.callbacks.playSound('setag_305');

    // Cercle container (trail particles) - behind everything
    this.cerclesContainer = new Container();
    this.cerclesContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.cerclesContainer);

    // Pierres container
    this.pierresContainer = new Container();
    this.pierresContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.pierresContainer);

    // Store textures for particle use
    this.pierresTextures = textures.getFrames('lib_pierres');
    this.cercleTextures = textures.getFrames('lib_cercle');

    // Shoot container (holds the main animation)
    this.shootContainer = new Container();
    this.shootContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.shootContainer);

    const shootTextures = textures.getFrames('shoot');
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);

    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: shootTextures,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));

    // Frame 1 (0-indexed: 0): play sound 'setag_310' and spawn pierres
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('setag_310');
      this.spawnPierres();
    });

    // Frame 130 (0-indexed: 129): start alpha fade
    this.shootAnim.onFrame(129, () => {
      this.fading = true;
    });

    // Frame 157 (0-indexed: 156): end of shoot animation
    this.shootAnim.stopAt(156);

    this.shootContainer.addChild(this.shootAnim.sprite);

    // Signal hit at first frame (instant ground spell)
    this.signalHit();
  }

  private spawnPierres(): void {
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);
    const scale = this.cachedScale;

    // AS: c = 0; while(c < 5) { this.attachMovie("pierres","pierres" + c, c); c++; }
    for (let c = 0; c < 5; c++) {
      // onClipEvent(load) for pierres:
      const vx = 5 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);
      const parentX = 20 * (Math.random() - 0.5);
      const parentY = 10 * (Math.random() - 0.5);
      const t = 60 + 40 * Math.random();
      const alpha = 20 + Math.floor(Math.random() * 90);
      const v = -10 * Math.random() - 5;
      const vr = 40 * (-0.5 + Math.random());

      const particleContainer = new Container();
      particleContainer.position.set(parentX, parentY);
      this.pierresContainer.addChild(particleContainer);

      const pierreTex = this.pierresTextures[0] ?? Texture.EMPTY;
      const spriteAnim = new FrameAnimatedSprite({
        textures: [pierreTex],
        anchorX: pierresAnchor.x,
        anchorY: pierresAnchor.y,
        scale: (t / 100) * scale,
      });
      spriteAnim.sprite.alpha = alpha / 100;
      spriteAnim.sprite.position.set(0, 0);
      particleContainer.addChild(spriteAnim.sprite);

      const pierre: PierreParticle = {
        container: particleContainer,
        spriteAnim,
        cx: parentX,
        cy: parentY,
        vx,
        vy,
        localY: 0,
        v,
        vr,
        rotation: 0,
        t,
        alpha,
        settled: false,
        alive: true,
      };

      this.pierres.push(pierre);
    }
  }

  private spawnCercle(x: number, y: number, vx: number, vy: number): void {
    // onClipEvent(load) for cercle:
    const va = 3 - Math.floor(Math.random() * 3);
    const t = 60 + Math.floor(Math.random() * 70);
    const alpha = 70 + Math.floor(Math.random() * 30);
    const r = 1.03 + 0.5 * Math.random();

    const cercleAnchor = calculateAnchor(CERCLE_MANIFEST);
    const cercleTex = this.cercleTextures[0] ?? Texture.EMPTY;
    const scale = this.cachedScale;

    const spriteAnim = new FrameAnimatedSprite({
      textures: [cercleTex],
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      scale: (t / 100) * scale,
    });

    spriteAnim.sprite.alpha = alpha / 100;
    spriteAnim.sprite.position.set(x, y);
    this.cerclesContainer.addChild(spriteAnim.sprite);

    const cercle: CercleParticle = {
      spriteAnim,
      x,
      y,
      vx,
      vy,
      alpha,
      va,
      r,
      alive: true,
    };

    this.cercles.push(cercle);
  }

  private updatePierres(): void {
    for (const p of this.pierres) {
      if (!p.alive) {
        continue;
      }

      // onClipEvent(enterFrame):
      // _parent._x += vx; _parent._y += vy;
      p.cx += p.vx;
      p.cy += p.vy;
      p.container.position.set(p.cx, p.cy);

      if (!p.settled) {
        // _Y = _Y + v
        p.localY += p.v;
        // _rotation = _rotation + vr
        p.rotation += p.vr;
        // v += 1.5
        p.v += 1.5;

        p.spriteAnim.sprite.position.set(0, p.localY);
        p.spriteAnim.sprite.rotation = (p.rotation * Math.PI) / 180;

        // if (_Y > 0)
        if (p.localY > 0) {
          p.vx /= 2;
          p.vy /= 2;
          p.rotation = 0;
          p.localY = 0;
          p.v = (-p.v) / 4;

          p.spriteAnim.sprite.rotation = 0;
          p.spriteAnim.sprite.position.set(0, 0);

          if (Math.abs(p.v) < 1) {
            p.vx = 0;
            p.vy = 0;
            p.settled = true;
          }
        }
      }
    }
  }

  private updateCercles(): void {
    for (const c of this.cercles) {
      if (!c.alive) {
        continue;
      }

      // onClipEvent(enterFrame):
      // if (_alpha < 5) { _parent.removeMovieClip(); }
      if (c.alpha < 5) {
        c.alive = false;
        c.spriteAnim.sprite.visible = false;
        continue;
      }

      // _alpha = _alpha - va
      c.alpha -= c.va;
      // _X = _X + _parent.vx
      c.x += c.vx;
      // _Y = _Y + _parent.vy
      c.y += c.vy;
      // _parent.vx /= r
      c.vx /= c.r;
      // _parent.vy /= r
      c.vy /= c.r;

      c.spriteAnim.sprite.position.set(c.x, c.y);
      c.spriteAnim.sprite.alpha = Math.max(0, c.alpha / 100);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updatePierres();
    this.updateCercles();

    // Apply alpha fade from frame 130 onwards
    if (this.fading) {
      this.shootAlpha -= 5;
      if (this.shootAlpha < 0) {
        this.shootAlpha = 0;
      }
      this.shootContainer.alpha = this.shootAlpha / 100;
    }

    // Spawn cercle trail each frame while shoot is still playing
    // AS: move clip tracks position changes and spawns cercles each enterFrame
    // Since target is fixed, vx/vy = 0; y offset of -20 as per AS code
    if (!this.shootAnim.isComplete() && !this.shootAnim.isStopped()) {
      this.spawnCercle(0, -20, 0, 0);
    }

    // Check completion: shoot stopped AND all cercles dead
    const allCerclesDead = this.cercles.every(c => !c.alive);

    if (this.shootAnim.isStopped() && allCerclesDead) {
      this.complete();
    }
  }

  destroy(): void {
    // Destroy pierre sprites
    for (const p of this.pierres) {
      p.spriteAnim.destroy();
    }
    this.pierres = [];

    // Destroy cercle sprites
    for (const c of this.cercles) {
      c.spriteAnim.destroy();
    }
    this.cercles = [];

    super.destroy();
  }
}
