/**
 * Spell 401 - Lakam
 *
 * A spell that spawns orbiting "point" particles rising upward, then signals hit.
 *
 * Components:
 * - anim1: Main composite animation at target position, 210 frames, stops at frame 207
 * - point particles (lib_point): Spawned every 3 frames while t < 20, orbit and rise
 *
 * Original AS timing:
 * - Frame 22 (DoAction): Play sound 'lakam_401a'
 * - Frame 145 (DoAction): Play sound 'lakam_401b'
 * - Frame 208 (DoAction): this._end() -> signalHit, then complete
 * - onClipEvent(load): t = 1
 * - onEnterFrame: if t < 20 && t % 3 == 1, attachMovie("point", ...) with sz and dec
 * - Each point: orbits ellipse (rx=15, ry=5), rises with p += 0.16, dies when t > 17
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
  width: 30.7,
  height: 241.7,
  offsetX: -14.7,
  offsetY: -232.8,
};

const POINT_MANIFEST: SpriteManifest = {
  width: 31.6,
  height: 33.8,
  offsetX: -9.9,
  offsetY: -20.55,
};

/**
 * Represents an individual "point" particle with AS-style orbital physics
 */
interface PointParticle {
  anim: FrameAnimatedSprite;
  sz: number;
  dec: number;
  p: number;
  y2: number;
  spawnT: number; // _parent.t at spawn time
  alive: boolean;
}

export class Spell401 extends BaseSpell {
  readonly spellId = 401;

  private mainAnim!: FrameAnimatedSprite;
  private pointsContainer!: Container;
  private points: PointParticle[] = [];
  private pointTextures: ReturnType<SpellTextureProvider['getFrames']> = [];

  // Replicates _parent.t counter from AS
  private t = 1;
  // Tracks which frame the main anim is on (for spawning logic)
  private lastMainFrame = -1;

  private pointAnchor = { x: 0, y: 0 };
  private initScale = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.initScale = init.scale;
    this.pointAnchor = calculateAnchor(POINT_MANIFEST);

    // Load point textures
    this.pointTextures = textures.getFrames('lib_point');

    // Main animation (anim1) at target position
    const mainAnchor = calculateAnchor(ANIM1_MANIFEST);
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('anim1'),
      anchorX: mainAnchor.x,
      anchorY: mainAnchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 22 (0-indexed: 21): play sound lakam_401a
    this.mainAnim.onFrame(21, () => this.callbacks.playSound('lakam_401a'));
    // Frame 145 (0-indexed: 144): play sound lakam_401b
    this.mainAnim.onFrame(144, () => this.callbacks.playSound('lakam_401b'));
    // Frame 208 (0-indexed: 207): _end() -> signalHit + complete
    this.mainAnim.onFrame(207, () => {
      this.signalHit();
      this.complete();
    });

    this.mainAnim.stopAt(207);

    this.container.addChild(this.mainAnim.sprite);

    // Container for point particles, at target position (same as main anim parent)
    this.pointsContainer = new Container();
    this.pointsContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.pointsContainer);

    // Initialize t = 1 (from onClipEvent load)
    this.t = 1;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // onEnterFrame logic: runs each frame
    // Spawn point particles while t < 20 and t % 3 == 1
    // We fire this each time the main anim advances to a new frame
    const currentFrame = this.mainAnim.getFrame();
    if (currentFrame !== this.lastMainFrame) {
      this.lastMainFrame = currentFrame;
      this.runEnterFrame();
    }

    // Update all alive point particles
    this.updatePoints();

    // Completion is handled via onFrame(207) callback
  }

  private runEnterFrame(): void {
    // AS: if(_parent.t < 20 & _parent.t % 3 == 1)
    if (this.t < 20 && this.t % 3 === 1) {
      this.spawnPoint(this.t);
    }
    this.t = this.t + 1;
  }

  private spawnPoint(tVal: number): void {
    if (this.pointTextures.length === 0) {
      return;
    }

    const texture = this.pointTextures[0];
    const anim = new FrameAnimatedSprite({
      textures: [texture],
      anchorX: this.pointAnchor.x,
      anchorY: this.pointAnchor.y,
      scale: this.initScale,
    });

    // AS: sz = 200 * Math.sin(_parent.t / 10)
    const sz = 200 * Math.sin(tVal / 10);

    // AS: dec = _parent.t
    const dec = tVal;

    // AS: _xscale = sz; _yscale = sz (applied in point DoAction frame 1)
    // sz is percentage, convert to 0-1 scale
    anim.sprite.scale.set((sz / 100) * this.initScale);

    // AS inner object's onClipEvent(load): _rotation = random(360)
    // Inner child rotation (the rotating sub-object)
    // We'll store this as a rotation on the sprite itself since we have a single sprite
    const innerRotation = Math.floor(Math.random() * 360);
    anim.sprite.rotation = (innerRotation * Math.PI) / 180;

    // AS point DoAction frame 1:
    // rx = 15; ry = 5; p = -50; _Y = -500; y2 = _Y
    const rx = 15;
    const ry = 5;
    const p = -50;
    const initialY = -500;

    const particle: PointParticle = {
      anim,
      sz,
      dec,
      p,
      y2: initialY,
      spawnT: tVal,
      alive: true,
    };

    // Position initial Y
    anim.sprite.position.set(0, initialY * this.initScale);

    this.pointsContainer.addChild(anim.sprite);
    this.points.push(particle);

    // Store physics params on particle for update
    // We need rx, ry accessible - store as extra fields
    (particle as PointParticle & { rx: number; ry: number; currentX: number; currentY: number; innerRotDeg: number }).rx = rx;
    (particle as PointParticle & { rx: number; ry: number; currentX: number; currentY: number; innerRotDeg: number }).ry = ry;
    (particle as PointParticle & { rx: number; ry: number; currentX: number; currentY: number; innerRotDeg: number }).currentX = 0;
    (particle as PointParticle & { rx: number; ry: number; currentX: number; currentY: number; innerRotDeg: number }).currentY = initialY;
    (particle as PointParticle & { rx: number; ry: number; currentX: number; currentY: number; innerRotDeg: number }).innerRotDeg = innerRotation;
  }

  private updatePoints(): void {
    for (const particle of this.points) {
      if (!particle.alive) {
        continue;
      }

      const p = particle as PointParticle & { rx: number; ry: number; currentX: number; currentY: number; innerRotDeg: number };

      // AS onEnterFrame (inner object): _rotation = _rotation - 2
      p.innerRotDeg = p.innerRotDeg - 2;
      p.anim.sprite.rotation = (p.innerRotDeg * Math.PI) / 180;

      // AS point onEnterFrame:
      // if(t > 17) { removeMovieClip(this); }
      // t = _parent.t / 12 + dec / 9
      // _X = rx * Math.cos(t)
      // y = ry * Math.sin(t)
      // y2 = y + (p += 0.16)
      // _Y = _Y - (_Y - y2) / 5
      // if(y < 0) { _alpha = 100 + y * 10; }

      const tLocal = this.t / 12 + particle.dec / 9;

      if (tLocal > 17) {
        particle.alive = false;
        p.anim.sprite.visible = false;
        continue;
      }

      const x = p.rx * Math.cos(tLocal);
      const y = p.ry * Math.sin(tLocal);

      particle.p += 0.16;
      particle.y2 = y + particle.p;

      p.currentY = p.currentY - (p.currentY - particle.y2) / 5;
      p.currentX = x;

      p.anim.sprite.position.set(p.currentX * this.initScale, p.currentY * this.initScale);

      if (y < 0) {
        p.anim.sprite.alpha = (100 + y * 10) / 100;
      } else {
        p.anim.sprite.alpha = 1;
      }
    }
  }

  destroy(): void {
    for (const particle of this.points) {
      particle.anim.destroy();
    }
    this.points = [];
    this.pointsContainer.destroy({ children: true });
    super.destroy();
  }
}
