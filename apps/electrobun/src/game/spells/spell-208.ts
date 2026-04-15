/**
 * Spell 208 - Fléau de Crâ (Crow's Bane)
 *
 * A projectile spell that shoots toward the target with a smoke trail.
 * At impact, feathers (plumes) and rocks (pierres) explode outward.
 *
 * Components:
 * - shoot (shoot frames): Projectile at caster, rotated toward target, 97 frames
 * - fumee (lib_fumee): Smoke particles spawned along projectile path each frame
 * - plumes (lib_plumes): 10 feather particles spawned at impact
 * - pierres (lib_pierres): Rock particles spawned at impact (2 per frame up to level*3)
 *
 * Original AS timing:
 * - Frame 1 (shoot): _rotation = -_parent.angle
 * - Frame 97 (shoot): _parent.removeMovieClip(); stop(); -> end of projectile, signal hit
 * - DefineSprite_25 frame 20: stop() -> impact anim timer
 * - Smoke particles: spawned every enter-frame along path
 * - Plumes: 10 spawned immediately at impact (frame 1 of DefineSprite_25)
 * - Pierres: 2 per frame until c >= level*3 (DefineSprite_25 PlaceObject2_23_2 enterFrame)
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container, Sprite, Texture } from "pixi.js";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 102,
  height: 102,
  offsetX: -53,
  offsetY: -93.7,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 20.15,
  height: 17.8,
  offsetX: -10.7,
  offsetY: -8.8,
};

const PLUMES_MANIFEST: SpriteManifest = {
  width: 21.75,
  height: 6.65,
  offsetX: -14,
  offsetY: -34.45,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

interface SmokeParticle {
  anim: FrameAnimatedSprite;
  alive: boolean;
}

interface PlumesParticle {
  sprite: Sprite;
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
  alive: boolean;
}

interface PierresParticle {
  sprite: Sprite;
  px: number;
  py: number;
  lx: number;
  ly: number;
  vx: number;
  vy: number;
  vr: number;
  v2x: number;
  v2y: number;
  v: number;
  t: number;
  tps: number;
  vd: number;
  alpha: number;
  alive: boolean;
}

export class Spell208 extends BaseSpell {
  readonly spellId = 208;

  private shootAnim!: FrameAnimatedSprite;

  private smokeContainer!: Container;
  private smokeParticles: SmokeParticle[] = [];
  private fumeTextures: Texture[] = [];

  private plumesContainer!: Container;
  private plumesParticles: PlumesParticle[] = [];
  private plumesTexture: Texture = Texture.EMPTY;

  private pierresContainer!: Container;
  private pierresParticles: PierresParticle[] = [];
  private pierresTexture: Texture = Texture.EMPTY;
  private pierresC = 0;

  private level = 1;
  private spellAngleRad = 0;

  private projectileDone = false;
  private impactSpawned = false;

  private casterX = 0;
  private casterY = 0;
  private targetX2 = 0;
  private targetY2 = 0;
  private readonly shootTotalFrames = 97;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    // angleRad = context.angle * PI/180; used with Math.cos/sin for pierres direction
    this.spellAngleRad = init.angleRad;

    this.casterX = 0;
    this.casterY = init.casterY;
    this.targetX2 = init.targetX;
    this.targetY2 = init.targetY;

    // Load textures for particle systems
    this.fumeTextures = textures.getFrames("lib_fumee");
    this.plumesTexture = textures.getFrames("lib_plumes")[0] ?? Texture.EMPTY;
    this.pierresTexture = textures.getFrames("lib_pierres")[0] ?? Texture.EMPTY;

    // Smoke container (rendered below projectile)
    this.smokeContainer = new Container();
    this.container.addChild(this.smokeContainer);

    // Shoot animation
    // AS frame 1: _rotation = -_parent.angle
    // AS frame 97: _parent.removeMovieClip(); stop();
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        fps: 25,
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(this.casterX, this.casterY);
    // AS: _rotation = -_parent.angle (angle is in degrees in context, negated for AS rotation)
    this.shootAnim.sprite.rotation = -((context?.angle ?? 0) * Math.PI) / 180;
    this.container.addChild(this.shootAnim.sprite);

    // Impact containers (hidden until projectile lands)
    this.plumesContainer = new Container();
    this.plumesContainer.position.set(init.targetX, init.targetY);
    this.plumesContainer.visible = false;
    this.container.addChild(this.plumesContainer);

    this.pierresContainer = new Container();
    this.pierresContainer.position.set(init.targetX, init.targetY);
    this.pierresContainer.visible = false;
    this.container.addChild(this.pierresContainer);
  }

  /**
   * Get interpolated position of the projectile for the given frame index
   */
  private getProjectilePosition(frame: number): { x: number; y: number } {
    const t =
      this.shootTotalFrames <= 1
        ? 1
        : Math.min(1, frame / (this.shootTotalFrames - 1));
    return {
      x: this.casterX + (this.targetX2 - this.casterX) * t,
      y: this.casterY + (this.targetY2 - this.casterY) * t,
    };
  }

  /**
   * Spawn a smoke particle at given position
   * AS: DefineSprite_22_fumee
   *   frame 1: _rotation = random(360)
   *   frame 8: gotoAndPlay(_currentframe + random(7))
   *   frame 36: removeMovieClip()
   */
  private spawnSmoke(x: number, y: number): void {
    if (this.fumeTextures.length === 0) {
      return;
    }

    const fumeeAnchor = calculateAnchor(FUMEE_MANIFEST);
    const anim = new FrameAnimatedSprite({
      textures: this.fumeTextures,
      fps: 25,
      anchorX: fumeeAnchor.x,
      anchorY: fumeeAnchor.y,
      scale: 1,
      startFrame: 0,
    });

    // AS frame 1: _rotation = random(360)  (1-indexed = index 0)
    anim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

    // AS frame 8: gotoAndPlay(_currentframe + random(7))  (1-indexed = index 7)
    anim.onFrame(7, () => {
      const currentF = anim.getFrame();
      const skip = Math.floor(Math.random() * 7);
      const target = Math.min(currentF + skip, this.fumeTextures.length - 1);
      anim.gotoFrame(target);
    });

    anim.sprite.position.set(x, y);
    this.smokeContainer.addChild(anim.sprite);

    this.smokeParticles.push({ anim, alive: true });
  }

  /**
   * Spawn impact particles (plumes)
   * AS: DefineSprite_25 frame_1/DoAction
   */
  private spawnImpact(): void {
    this.plumesContainer.visible = true;
    this.pierresContainer.visible = true;

    // AS: p = 0; while(p < 10) { attachMovie("plumes", ...) }
    for (let p = 0; p < 10; p++) {
      this.spawnPlumes();
    }
  }

  /**
   * Spawn a single plumes (feather) particle
   * AS: DefineSprite_18_plumes onClipEvent(load)
   * Plus override from DefineSprite_25: vx/vy = 40 * (Math.random() - 0.5)
   */
  private spawnPlumes(): void {
    const sprite = new Sprite(this.plumesTexture);
    const anchor = calculateAnchor(PLUMES_MANIFEST);
    sprite.anchor.set(anchor.x, anchor.y);

    // AS: if(random(2) == 1) { _xscale = -_xscale; }
    const flipX = Math.floor(Math.random() * 2) === 1;

    // AS: t = 40 + random(60)
    const t = 40 + Math.floor(Math.random() * 60);

    // AS: duree = 40 + random(30)
    const duree = 40 + Math.floor(Math.random() * 30);

    // AS: _xscale = t; _yscale = t  (then flip xscale if needed)
    let scaleX = t / 100;
    if (flipX) {
      scaleX = -scaleX;
    }
    sprite.scale.set(scaleX, t / 100);

    // AS parent override (DefineSprite_25 frame 1):
    // eval("this.plumes" + c).vx = 40 * (Math.random() - 0.5)
    // eval("this.plumes" + c).vy = 40 * (Math.random() - 0.5)
    // These are set after attachMovie so they override the load values
    const vx = 40 * (Math.random() - 0.5);
    const vy = 40 * (Math.random() - 0.5);

    // AS: vch = 0.2 + 0.3 * Math.random()
    const vch = 0.2 + 0.3 * Math.random();

    // AS: vr = 0.1 + 0.3 * Math.random()
    const vr = 0.1 + 0.3 * Math.random();

    // AS: amp = 30 + random(70)
    const amp = 30 + Math.floor(Math.random() * 70);

    const particle: PlumesParticle = {
      sprite,
      x: 0,
      y: 0,
      vx,
      vy,
      vch,
      vr,
      amp,
      a: 0,
      time: 0,
      duree,
      alpha: 1,
      alive: true,
    };

    this.plumesContainer.addChild(sprite);
    this.plumesParticles.push(particle);
  }

  /**
   * Spawn a single pierres (rock) particle
   * AS: DefineSprite_6_pierres onClipEvent(load)
   */
  private spawnPierres(): void {
    const sprite = new Sprite(this.pierresTexture);
    const anchor = calculateAnchor(PIERRES_MANIFEST);
    sprite.anchor.set(anchor.x, anchor.y);

    // AS: vd = 30 + random(30)
    const vd = 30 + Math.floor(Math.random() * 30);

    // AS: vx = 15 * (Math.random() - 0.5)
    const vx = 15 * (Math.random() - 0.5);

    // AS: vy = 15 * (Math.random() - 0.5)
    const vy = 15 * (Math.random() - 0.5);

    // AS: an = _parent._parent._parent._parent._parent.angle + 3.1415
    // The spell angle property is used directly with Math.cos/sin, so it is in radians
    const an = this.spellAngleRad + Math.PI;

    // AS: v2x = Math.cos(an) * 2
    const v2x = Math.cos(an) * 2;

    // AS: v2y = Math.sin(an) * 5
    const v2y = Math.sin(an) * 5;

    // AS: _parent._x = 20 * (Math.random() - 0.5)
    const px = 20 * (Math.random() - 0.5);

    // AS: _parent._y = 10 * (Math.random() - 0.5)
    const py = 10 * (Math.random() - 0.5);

    // AS: t = 60 + 40 * Math.random()
    const t = 60 + 40 * Math.random();

    // AS: v = -10
    const v = -10;

    // AS: _xscale = t; _yscale = t
    sprite.scale.set(t / 100);

    // AS: vr = 60 * (-0.5 + Math.random())
    const vr = 60 * (-0.5 + Math.random());

    const particle: PierresParticle = {
      sprite,
      px,
      py,
      lx: 0,
      ly: 0,
      vx,
      vy,
      vr,
      v2x,
      v2y,
      v,
      t,
      tps: 0,
      vd,
      alpha: 1,
      alive: true,
    };

    sprite.position.set(px, py);

    this.pierresContainer.addChild(sprite);
    this.pierresParticles.push(particle);
  }

  /**
   * Update smoke particles
   */
  private updateSmoke(deltaTime: number): void {
    for (const p of this.smokeParticles) {
      if (!p.alive) {
        continue;
      }

      p.anim.update(deltaTime);

      if (p.anim.isComplete()) {
        p.alive = false;
        p.anim.sprite.visible = false;
      }
    }
  }

  /**
   * Update plumes particles per frame
   * AS: DefineSprite_18_plumes onClipEvent(enterFrame)
   */
  private updatePlumes(): void {
    for (const p of this.plumesParticles) {
      if (!p.alive) {
        continue;
      }

      // AS: if(time++ > duree) { _alpha = _alpha - 10; }
      // _alpha is 0-100 in AS; we store alpha as 0-1
      if (p.time++ > p.duree) {
        p.alpha -= 10 / 100;
      }

      // AS: if(_Y < 0) { ... }
      if (p.y < 0) {
        // AS: _Y = _Y + (vy += vch)
        p.vy += p.vch;
        p.y += p.vy;

        // AS: _X = _X + vx
        p.x += p.vx;

        // AS: vy *= 0.9
        p.vy *= 0.9;

        // AS: vx *= 0.9
        p.vx *= 0.9;

        // AS: amp *= 0.98
        p.amp *= 0.98;

        // AS: _rotation = amp * Math.cos(a += vr)
        p.a += p.vr;
        p.sprite.rotation = (p.amp * Math.cos(p.a) * Math.PI) / 180;
      }

      p.sprite.position.set(p.x, p.y);
      p.sprite.alpha = Math.max(0, p.alpha);

      if (p.alpha <= 0) {
        p.alive = false;
        p.sprite.visible = false;
      }
    }
  }

  /**
   * Update pierres particles per frame
   * AS: DefineSprite_6_pierres onClipEvent(enterFrame)
   */
  private updatePierres(): void {
    for (const p of this.pierresParticles) {
      if (!p.alive) {
        continue;
      }

      // AS: if(_alpha < 10) { removeMovieClip(_parent); }
      if (p.alpha * 100 < 10) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }

      // AS: _parent._x += vx; _parent._y += vy
      p.px += p.vx;
      p.py += p.vy;

      // AS: _rotation = _rotation + vr
      p.sprite.rotation += (p.vr * Math.PI) / 180;

      // AS: if(tps++ < vd) { vx /= 1.2; vy /= 1.2; v /= 1.2; }
      // tps post-increments: compare with old value, then increment
      if (p.tps++ < p.vd) {
        p.vx /= 1.2;
        p.vy /= 1.2;
        p.v /= 1.2;
      }

      // AS: if(tps++ > vd) { ... }
      // tps post-increments again: compare with old value, then increment
      if (p.tps++ > p.vd) {
        // AS: _Y = _Y + (v2y *= 1.2)
        p.v2y *= 1.2;
        p.ly += p.v2y;

        // AS: _X = _X + (v2x *= 1.2)
        p.v2x *= 1.2;
        p.lx += p.v2x;

        // AS: _alpha -= 10
        p.alpha -= 10 / 100;
      }

      p.sprite.position.set(p.px + p.lx, p.py + p.ly);
      p.sprite.alpha = Math.max(0, p.alpha);

      if (p.alpha <= 0) {
        p.alive = false;
        p.sprite.visible = false;
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    if (!this.projectileDone) {
      // Update shoot animation
      this.anims.update(deltaTime);

      const currentFrame = this.shootAnim.getFrame();
      const pos = this.getProjectilePosition(currentFrame);

      // Spawn smoke trail at current position
      // AS: DefineSprite_15_move onEnterFrame - attachMovie("fumee", ...) each frame
      this.spawnSmoke(pos.x, pos.y);

      // Move shoot sprite along the path
      this.shootAnim.sprite.position.set(pos.x, pos.y);

      // Check if shoot animation completed (frame 97, index 96 = last frame)
      if (this.shootAnim.isComplete()) {
        this.projectileDone = true;
        this.shootAnim.sprite.visible = false;

        // Signal hit when projectile reaches target
        this.signalHit();

        if (!this.impactSpawned) {
          this.impactSpawned = true;
          this.spawnImpact();
        }
      }
    }

    // Update smoke particles
    this.updateSmoke(deltaTime);

    // Update impact particles
    if (this.impactSpawned) {
      this.updatePlumes();
      this.updatePierres();

      // AS: DefineSprite_25/PlaceObject2_23_2 onClipEvent(enterFrame):
      // if(c < _parent._parent._parent.level * 3) { c++; attachMovie("pierres"...); c++; attachMovie("pierres"...); }
      if (this.pierresC < this.level * 3) {
        this.pierresC += 1;
        this.spawnPierres();
        this.pierresC += 1;
        this.spawnPierres();
      }
    }

    // Check completion: projectile done + all particles gone
    if (this.projectileDone) {
      const hasAliveSmoke = this.smokeParticles.some((p) => p.alive);
      const hasAlivePlumes = this.plumesParticles.some((p) => p.alive);
      const hasAlivePierres = this.pierresParticles.some((p) => p.alive);

      if (!hasAliveSmoke && !hasAlivePlumes && !hasAlivePierres) {
        this.complete();
      }
    }
  }

  destroy(): void {
    for (const p of this.smokeParticles) {
      p.anim.destroy();
    }
    this.smokeParticles = [];

    for (const p of this.plumesParticles) {
      p.sprite.destroy();
    }
    this.plumesParticles = [];

    for (const p of this.pierresParticles) {
      p.sprite.destroy();
    }
    this.pierresParticles = [];

    super.destroy();
  }
}
