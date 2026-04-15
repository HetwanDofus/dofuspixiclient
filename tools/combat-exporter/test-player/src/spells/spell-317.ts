/**
 * Spell 317 - Setag (Earth Cra)
 *
 * A projectile spell that fires a "shoot" animation from caster to target,
 * with stone particles (pierres) and trail circles (cercle).
 *
 * Components:
 * - shoot (DefineSprite_24_shoot): Main projectile animation at target position
 *   - Contains 5 "pierres" (stone) particles spawned at frame 1
 *   - Trail "cercle" particles spawned each frame tracking movement
 *   - Alpha fade starts at frame 44 (-10 per frame)
 *   - Ends at frame 53
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'setag_305'
 * - Frame 1 (shoot): Play sound 'setag_310', spawn 5 pierres particles
 * - Frame 44 (shoot): Start alpha fade (-10 per frame)
 * - Frame 53 (shoot): removeMovieClip() / stop() - animation ends
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
  width: 108.75,
  height: 64.95,
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
 * A "pierres" (stone) particle with bounce physics
 */
interface PierreParticle {
  /** Parent container (tracks _parent._x, _parent._y) */
  container: Container;
  /** Inner sprite (tracks _Y, _rotation relative to container) */
  anim: FrameAnimatedSprite;
  /** Horizontal velocity of the container */
  vx: number;
  /** Vertical velocity of the container */
  vy: number;
  /** Vertical velocity of the inner sprite */
  v: number;
  /** Rotation velocity of the inner sprite */
  vr: number;
  /** Inner sprite Y position (local) */
  localY: number;
  /** Inner sprite rotation (degrees) */
  rotation: number;
  /** t flag: when 1, particle is settled/done moving */
  t: number;
  /** alive flag */
  alive: boolean;
}

/**
 * A "cercle" (circle trail) particle
 */
interface CercleParticle {
  anim: FrameAnimatedSprite;
  /** Local X position */
  localX: number;
  /** Local Y position */
  localY: number;
  /** X velocity (from move sprite delta) */
  vx: number;
  /** Y velocity (from move sprite delta) */
  vy: number;
  /** Alpha */
  alpha: number;
  /** Alpha decay per frame */
  va: number;
  /** Velocity decay factor */
  r: number;
  /** alive flag */
  alive: boolean;
}

export class Spell317 extends BaseSpell {
  readonly spellId = 317;

  private shootAnim!: FrameAnimatedSprite;
  private shootContainer!: Container;

  /** Pierres (stone) particles */
  private pierresParticles: PierreParticle[] = [];
  /** Cercle (circle trail) particles */
  private cercleParticles: CercleParticle[] = [];

  /** alpha fade for shoot container (starts at frame 44) */
  private shootAlpha = 100;
  private shootFading = false;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play main sound at frame 1 (index 0)
    this.callbacks.playSound('setag_305');

    // Container for the shoot animation (positioned at target)
    this.shootContainer = new Container();
    this.shootContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.shootContainer);

    // Main shoot animation
    const shootTextures = textures.getFrames('shoot');
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: shootTextures,
      fps: 120,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(0, 0);

    // Frame 1 of shoot (index 0): play sound, spawn pierres
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('setag_310');
      this.spawnPierres(textures, init.scale);
    });

    // Frame 44 (index 43): start alpha fade
    this.shootAnim.onFrame(43, () => {
      this.shootFading = true;
    });

    // Frame 53 (index 52): signal hit and complete
    this.shootAnim.onFrame(52, () => {
      this.signalHit();
    });

    this.shootContainer.addChild(this.shootAnim.sprite);
  }

  /**
   * Spawn 5 "pierres" stone particles at the shoot position.
   * AS: c = 0; while(c < 5) { attachMovie("pierres","pierres"+c,c); c++; }
   */
  private spawnPierres(textures: SpellTextureProvider, scale: number): void {
    const pierresTextures = textures.getFrames('lib_pierres');
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);

    for (let c = 0; c < 5; c++) {
      const parentContainer = new Container();

      // AS load: _parent._x = 20 * (Math.random() - 0.5); _parent._y = 10 * (Math.random() - 0.5);
      const parentX = 20 * (Math.random() - 0.5);
      const parentY = 10 * (Math.random() - 0.5);
      parentContainer.position.set(parentX, parentY);

      // AS load: vx = 5 * (Math.random() - 0.5); vy = 2 * (Math.random() - 0.5);
      const vx = 5 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);

      // AS load: t = 60 + 40 * Math.random();
      const t = 60 + 40 * Math.random();

      // AS load: _alpha = 20 + random(90);
      const alpha = (20 + Math.floor(Math.random() * 90)) / 100;

      // AS load: v = -10 * Math.random() - 5;
      const v = -10 * Math.random() - 5;

      // AS load: vr = 40 * (-0.5 + Math.random());
      const vr = 40 * (-0.5 + Math.random());

      const anim = new FrameAnimatedSprite({
        textures: pierresTextures,
        fps: 120,
        anchorX: pierresAnchor.x,
        anchorY: pierresAnchor.y,
        scale: (t / 100) * scale,
        loop: true,
      });

      anim.sprite.alpha = alpha;
      anim.sprite.position.set(0, 0);

      parentContainer.addChild(anim.sprite);
      this.shootContainer.addChild(parentContainer);

      this.pierresParticles.push({
        container: parentContainer,
        anim,
        vx,
        vy,
        v,
        vr,
        localY: 0,
        rotation: 0,
        t,
        alive: true,
      });
    }
  }

  /**
   * Spawn a "cercle" trail particle at a given position with velocity.
   * AS (DefineSprite_8_move): attachMovie("cercle","cercle"+c,c); set pos and velocity
   */
  private spawnCercle(textures: SpellTextureProvider, scale: number, x: number, y: number, vx: number, vy: number): void {
    const cercleTextures = textures.getFrames('lib_cercle');
    const cercleAnchor = calculateAnchor(CERCLE_MANIFEST);

    // AS cercle load: va = 4 - random(3); -> 4-0, 4-1, or 4-2 => 2, 3, or 4
    const va = 4 - Math.floor(Math.random() * 3);

    // AS cercle load: t = 60 + random(70);
    const t = 60 + Math.floor(Math.random() * 70);

    // AS cercle load: _alpha = 70 + random(30);
    const alpha = (70 + Math.floor(Math.random() * 30)) / 100;

    // AS cercle load: r = 1.1 + 0.5 * Math.random();
    const r = 1.1 + 0.5 * Math.random();

    const anim = new FrameAnimatedSprite({
      textures: cercleTextures,
      fps: 120,
      anchorX: cercleAnchor.x,
      anchorY: cercleAnchor.y,
      scale: (t / 100) * scale,
      loop: true,
    });

    anim.sprite.position.set(x, y);
    anim.sprite.alpha = alpha;

    this.shootContainer.addChild(anim.sprite);

    this.cercleParticles.push({
      anim,
      localX: x,
      localY: y,
      vx,
      vy,
      alpha: alpha * 100, // store as 0-100 for easier math
      va,
      r,
      alive: true,
    });
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update main shoot animation
    this.anims.update(deltaTime);

    // Handle alpha fade (frame 44+: _alpha -= 10 per frame)
    if (this.shootFading) {
      // Each frame at 120fps = 1000/120 ms
      // We apply 10% alpha reduction per game frame (per enterFrame event)
      // deltaTime is in ms, frameTime = 1000/120
      const framesToApply = deltaTime / (1000 / 120);
      this.shootAlpha -= 10 * framesToApply;
      if (this.shootAlpha < 0) {
        this.shootAlpha = 0;
      }
      this.shootContainer.alpha = this.shootAlpha / 100;
    }

    // Update pierres particles
    this.updatePierres(deltaTime);

    // Update cercle particles
    this.updateCercles(deltaTime);

    // Check completion: shoot animation done and no alive particles
    if (this.shootAnim.isComplete() && !this.hasPierresAlive() && !this.hasCerclesAlive()) {
      this.complete();
    }
  }

  private updatePierres(deltaTime: number): void {
    const framesToApply = deltaTime / (1000 / 120);

    for (const p of this.pierresParticles) {
      if (!p.alive) {
        continue;
      }

      // AS enterFrame: _parent._x += vx; _parent._y += vy;
      const newParentX = p.container.x + p.vx * framesToApply;
      const newParentY = p.container.y + p.vy * framesToApply;
      p.container.position.set(newParentX, newParentY);

      if (p.t !== 1) {
        // AS: _Y = _Y + v; _rotation = _rotation + vr; v += 1.5;
        p.localY += p.v * framesToApply;
        p.rotation += p.vr * framesToApply;
        p.v += 1.5 * framesToApply;

        // AS: if(_Y > 0) { bounce/settle }
        if (p.localY > 0) {
          p.vx /= Math.pow(2, framesToApply);
          p.vy /= Math.pow(2, framesToApply);
          p.rotation = 0;
          p.localY = 0;
          p.v = (-p.v) / 4;

          if (Math.abs(p.v) < 1) {
            p.vx = 0;
            p.vy = 0;
            p.t = 1;
          }
        }

        p.anim.sprite.position.set(0, p.localY);
        p.anim.sprite.rotation = (p.rotation * Math.PI) / 180;
      }

      // Update the inner animation
      p.anim.update(deltaTime);
    }
  }

  private updateCercles(deltaTime: number): void {
    const framesToApply = deltaTime / (1000 / 120);

    for (const c of this.cercleParticles) {
      if (!c.alive) {
        continue;
      }

      // AS enterFrame: if(_alpha < 10) removeMovieClip();
      if (c.alpha < 10) {
        c.alive = false;
        c.anim.sprite.visible = false;
        continue;
      }

      // AS: _alpha = _alpha - va;
      c.alpha -= c.va * framesToApply;

      // AS: _X = _X + _parent.vx; _Y = _Y + _parent.vy;
      c.localX += c.vx * framesToApply;
      c.localY += c.vy * framesToApply;

      // AS: _parent.vx /= r; _parent.vy /= r;
      c.vx /= Math.pow(c.r, framesToApply);
      c.vy /= Math.pow(c.r, framesToApply);

      c.anim.sprite.position.set(c.localX, c.localY);
      c.anim.sprite.alpha = Math.max(0, c.alpha / 100);

      if (c.alpha <= 0) {
        c.alive = false;
        c.anim.sprite.visible = false;
      }
    }
  }

  private hasPierresAlive(): boolean {
    return this.pierresParticles.some(p => p.alive);
  }

  private hasCerclesAlive(): boolean {
    return this.cercleParticles.some(c => c.alive);
  }

  destroy(): void {
    // Destroy pierre anim sprites
    for (const p of this.pierresParticles) {
      p.anim.destroy();
    }
    this.pierresParticles = [];

    // Destroy cercle anim sprites
    for (const c of this.cercleParticles) {
      c.anim.destroy();
    }
    this.cercleParticles = [];

    super.destroy();
  }
}
