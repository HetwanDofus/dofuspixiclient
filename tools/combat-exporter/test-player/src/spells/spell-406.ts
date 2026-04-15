/**
 * Spell 406 - Lakam (Osamodas rock throw)
 *
 * A projectile spell that launches rocks from caster toward target.
 *
 * Components:
 * - shoot (DefineSprite_9_shoot): Main 213-frame animation at target position
 *   - Frame 4 (AS): set rotation to angle
 *   - Frame 49 (AS): signal hit
 *   - Frame 142 (AS): complete (removeMovieClip)
 *   - Frame 211 (AS): stop()
 * - Pierre particles: rock debris spawned from up to 4 emitters based on level
 *   - Emitter at AS frame 1: visible if level >= 2
 *   - Emitter at AS frame 7: visible if level >= 3
 *   - Emitter at AS frame 31: visible if level >= 2
 *   - Emitter at AS frame 37: visible if level >= 3
 *
 * Original AS timing:
 * - Frame 1 (main timeline): Play sound 'lakam_405'
 * - Frame 4 (DefineSprite_22): _rotation = _parent.angle
 * - Frame 49 (DefineSprite_22): this.end() → signal hit
 * - Frame 142 (DefineSprite_22): removeMovieClip → complete
 * - Frame 211 (DefineSprite_9_shoot): stop()
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
  width: 126.25,
  height: 122.8,
  offsetX: -61.6,
  offsetY: -103.15,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 16.15,
  height: 20.5,
  offsetX: -8.15,
  offsetY: -8.6,
};

interface PierreParticle {
  /** The outer container whose _x/_y is updated by vx/vy */
  outerContainer: Container;
  /** The inner sprite whose _X/_Y is updated by v / v2x / v2y */
  innerSprite: FrameAnimatedSprite;
  /** Outer container world X position */
  px: number;
  /** Outer container world Y position */
  py: number;
  /** Inner sprite local X */
  innerX: number;
  /** Inner sprite local Y */
  innerY: number;
  vx: number;
  vy: number;
  v2x: number;
  v2y: number;
  /** Vertical arc velocity */
  v: number;
  /** Rotation in degrees */
  rotationDeg: number;
  vr: number;
  /** Alpha (0-100) */
  alpha: number;
  /** Frame counter */
  tps: number;
  /** Duration of arc phase */
  vd: number;
  alive: boolean;
}

export class Spell406 extends BaseSpell {
  readonly spellId = 406;

  private shootAnim!: FrameAnimatedSprite;
  private pierreParticles: PierreParticle[] = [];

  private level = 1;
  private angleRad = 0;
  private spawnX = 0;
  private spawnY = 0;
  private extractionScale = 1;
  private pierreTextures: Texture[] = [];

  private pierreFrameAccum = 0;
  private readonly FRAME_TIME = 1000 / 60;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.angleRad = init.angleRad;
    this.extractionScale = init.scale;
    this.spawnX = init.targetX;
    this.spawnY = init.targetY;

    // Store pierre textures for deferred spawning
    this.pierreTextures = textures.getFrames('lib_pierres');

    // Main shoot animation at target position
    const anchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      anchorX: anchor.x,
      anchorY: anchor.y,
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 0 (AS frame 1): play sound
    this.shootAnim.onFrame(0, () => {
      this.callbacks.playSound('lakam_405');
    });

    // Frame 3 (AS frame 4): set rotation to angle
    this.shootAnim.onFrame(3, () => {
      this.shootAnim.sprite.rotation = this.angleRad;
    });

    // Frame 48 (AS frame 49): signal hit
    this.shootAnim.onFrame(48, () => {
      this.signalHit();
    });

    // Frame 141 (AS frame 142): removeMovieClip → complete
    this.shootAnim.onFrame(141, () => {
      this.complete();
    });

    // Stop at frame 210 (AS frame 211)
    this.shootAnim.stopAt(210);

    this.container.addChild(this.shootAnim.sprite);

    // Register pierre emitters based on level
    // PlaceObject2_21_6 at AS frame 1 → TS frame 0, visible if level >= 2
    if (this.level >= 2) {
      this.shootAnim.onFrame(0, () => {
        this.runEmitter();
      });
    }

    // PlaceObject2_21_11 at AS frame 7 → TS frame 6, visible if level >= 3
    if (this.level >= 3) {
      this.shootAnim.onFrame(6, () => {
        this.runEmitter();
      });
    }

    // PlaceObject2_21_16 at AS frame 31 → TS frame 30, visible if level >= 2
    if (this.level >= 2) {
      this.shootAnim.onFrame(30, () => {
        this.runEmitter();
      });
    }

    // PlaceObject2_21_26 at AS frame 37 → TS frame 36, visible if level >= 3
    if (this.level >= 3) {
      this.shootAnim.onFrame(36, () => {
        this.runEmitter();
      });
    }
  }

  /**
   * Simulate one DefineSprite_6 emitter running through all its frames.
   * AS: c starts at 0; each enterFrame while c < level*3: attach 2 pierres, c+=2
   * So total pierres = level*3 rounded up to next even number.
   */
  private runEmitter(): void {
    const maxC = this.level * 3;
    let c = 0;
    while (c < maxC) {
      this.spawnPierre();
      c += 1;
      this.spawnPierre();
      c += 1;
    }
  }

  private spawnPierre(): void {
    // AS: DefineSprite_15_pierres onClipEvent(load)
    // vd = 90 + random(90)   → [90, 179]
    const vd = 90 + Math.floor(Math.random() * 90);

    // gotoAndPlay(random(12) + 1) → start frame [0, 11] (0-indexed)
    const startFrame = Math.floor(Math.random() * 12);

    // vx = 15 * (Math.random() - 0.5)
    const vx = 15 * (Math.random() - 0.5);

    // vy = 15 * (Math.random() - 0.5)
    const vy = 15 * (Math.random() - 0.5);

    // an = _parent._parent._parent._parent._parent.angle + PI
    const an = this.angleRad + Math.PI;

    // v2x = Math.cos(an) * 5
    const v2x = Math.cos(an) * 5;

    // v2y = Math.sin(an) * 5
    const v2y = Math.sin(an) * 5;

    // _parent._x = 20 * (Math.random() - 0.5)
    const pOffX = 20 * (Math.random() - 0.5);

    // _parent._y = 10 * (Math.random() - 0.5)
    const pOffY = 10 * (Math.random() - 0.5);

    // t = 60 + 40 * Math.random()
    const t = 60 + 40 * Math.random();

    // v = -10
    const v = -10;

    // vr = 30 * (-0.5 + Math.random())
    const vr = 30 * (-0.5 + Math.random());

    // Create outer container (the _parent of the inner sprite in AS)
    const outerContainer = new Container();
    const worldX = this.spawnX + pOffX;
    const worldY = this.spawnY + pOffY;
    outerContainer.position.set(worldX, worldY);
    this.container.addChild(outerContainer);

    // Create inner sprite (DefineSprite_15_pierres content)
    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);
    const innerSprite = new FrameAnimatedSprite({
      textures: this.pierreTextures,
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      scale: this.extractionScale,
      startFrame,
      loop: true,
    });

    // Apply initial t scale (t is percentage: t/100, then apply extractionScale separately)
    // AS: _xscale = t; _yscale = t; means scale = t/100 in normalized units
    const tScale = (t / 100) * this.extractionScale;
    innerSprite.sprite.scale.set(tScale);

    // AS: DefineSprite_3 inside has _rotation = random(360)
    const initialRotDeg = Math.floor(Math.random() * 360);
    innerSprite.sprite.rotation = (initialRotDeg * Math.PI) / 180;

    innerSprite.sprite.position.set(0, 0);
    outerContainer.addChild(innerSprite.sprite);

    const particle: PierreParticle = {
      outerContainer,
      innerSprite,
      px: worldX,
      py: worldY,
      innerX: 0,
      innerY: 0,
      vx,
      vy,
      v2x,
      v2y,
      v,
      rotationDeg: initialRotDeg,
      vr,
      alpha: 100,
      tps: 0,
      vd,
      alive: true,
    };

    this.pierreParticles.push(particle);
  }

  private updatePierres(): void {
    for (const p of this.pierreParticles) {
      if (!p.alive) {
        continue;
      }

      // AS: if(_alpha < 10) { removeMovieClip(_parent); }
      if (p.alpha < 10) {
        p.alive = false;
        p.outerContainer.visible = false;
        continue;
      }

      // AS: _parent._x += vx; _parent._y += vy;
      p.px += p.vx;
      p.py += p.vy;

      // AS: _rotation = _rotation + vr
      p.rotationDeg += p.vr;

      // AS: if(tps++ < vd) { _Y += v; vx /= 1.2; vy /= 1.2; v /= 1.2; }
      // Post-increment: evaluate tps < vd first, then tps++
      if (p.tps < p.vd) {
        p.innerY += p.v;
        p.vx /= 1.2;
        p.vy /= 1.2;
        p.v /= 1.2;
      }
      p.tps++;

      // AS: if(tps++ > vd) { _Y += (v2y *= 1.06); _X += (v2x *= 1.06); _alpha -= 1; }
      // tps was already incremented once; now check with new value, then increment again
      if (p.tps > p.vd) {
        p.innerY += (p.v2y *= 1.06);
        p.innerX += (p.v2x *= 1.06);
        p.alpha -= 1;
      }
      p.tps++;

      // Apply outer container position
      p.outerContainer.position.set(p.px, p.py);

      // Apply inner sprite local position and rotation
      p.innerSprite.sprite.position.set(p.innerX, p.innerY);
      p.innerSprite.sprite.rotation = (p.rotationDeg * Math.PI) / 180;

      // Apply alpha to outer container
      p.outerContainer.alpha = Math.max(0, p.alpha / 100);

      // Advance inner sprite animation
      p.innerSprite.update(this.FRAME_TIME);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update pierre particles at 60fps
    this.pierreFrameAccum += deltaTime;
    while (this.pierreFrameAccum >= this.FRAME_TIME) {
      this.updatePierres();
      this.pierreFrameAccum -= this.FRAME_TIME;
    }
  }

  destroy(): void {
    for (const p of this.pierreParticles) {
      p.innerSprite.destroy();
      if (p.outerContainer.parent) {
        p.outerContainer.parent.removeChild(p.outerContainer);
      }
      p.outerContainer.destroy({ children: true });
    }
    this.pierreParticles = [];
    super.destroy();
  }
}
