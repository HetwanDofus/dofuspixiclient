/**
 * Spell 207 - Crockette (Osamodas)
 *
 * A projectile spell that fires a "shoot" animation from caster to target,
 * trailing smoke particles ("fumee") along its path and exploding into
 * feather particles ("plumes") on impact.
 *
 * Components:
 * - shoot: Main projectile animation, 291 frames, travels from caster to target
 * - fumee (lib_fumee): Smoke trail particles spawned each frame along projectile path
 * - plumes (lib_plumes): Feather burst particles spawned at impact (10 particles)
 *
 * Original AS timing:
 * - Frame 1 (main): SOMA.playSound("crockette_207")
 * - DefineSprite_15_move onEnterFrame: spawn fumee at current projectile position each frame
 * - DefineSprite_19_fumee frame_1: _rotation = random(360)
 * - DefineSprite_19_fumee frame_13 (0-indexed: 12): gotoAndPlay(_currentframe + random(21))
 * - DefineSprite_19_fumee frame_64 (0-indexed: 63): removeMovieClip()
 * - DefineSprite_2 frame_1: spawn 10 plumes at impact with random vx/vy
 * - DefineSprite_2 frame_39 (0-indexed: 38): stop()
 * - DefineSprite_3_shoot frame_289 (0-indexed: 288): stop() + _parent.removeMovieClip()
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
  width: 92.9,
  height: 92.9,
  offsetX: -43.5,
  offsetY: -74.2,
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

interface PlumesParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  duree: number;
  time: number;
  amp: number;
  a: number;
  vch: number;
  vr: number;
  alpha: number;
  sprite: Sprite;
  alive: boolean;
}

/**
 * Manages a single fumee (smoke) instance replicating DefineSprite_19_fumee behavior:
 * - frame_1 DoAction: _rotation = random(360)
 * - frame_13 (0-indexed: 12): gotoAndPlay(_currentframe + random(21))
 * - frame_64 (0-indexed: 63): removeMovieClip()
 */
class FumeeInstance {
  readonly anim: FrameAnimatedSprite;
  private skippedAtFrame12 = false;
  private _dead = false;

  constructor(
    textures: Texture[],
    anchorX: number,
    anchorY: number,
    scale: number
  ) {
    this.anim = new FrameAnimatedSprite({
      textures,
      anchorX,
      anchorY,
      scale,
    });
    // frame_1 DoAction: _rotation = random(360)
    this.anim.sprite.rotation =
      (Math.floor(Math.random() * 360) * Math.PI) / 180;
  }

  get dead(): boolean {
    return this._dead;
  }

  update(deltaTime: number): void {
    if (this._dead) {
      return;
    }

    this.anim.update(deltaTime);

    const frame = this.anim.getFrame();

    // frame_13 (AS 1-indexed) = frame 12 (0-indexed): gotoAndPlay(_currentframe + random(21))
    if (!this.skippedAtFrame12 && frame >= 12) {
      this.skippedAtFrame12 = true;
      const skip = Math.floor(Math.random() * 21);
      const newFrame = Math.min(frame + skip, 65);
      this.anim.gotoFrame(newFrame);
    }

    // frame_64 (AS 1-indexed) = frame 63 (0-indexed): removeMovieClip()
    if (frame >= 63 || this.anim.isComplete()) {
      this._dead = true;
      this.anim.sprite.visible = false;
    }
  }
}

export class Spell207 extends BaseSpell {
  readonly spellId = 207;

  private shootAnim!: FrameAnimatedSprite;

  // Smoke trail
  private fumeeContainer!: Container;
  private fumeeInstances: FumeeInstance[] = [];
  private fumeeTextures: Texture[] = [];
  private fumeeAnchorX = 0;
  private fumeeAnchorY = 0;
  private fumeeScale = 1;

  // Plumes (feather burst at impact)
  private plumesContainer!: Container;
  private plumesParticles: PlumesParticle[] = [];
  private plumesTexture: Texture = Texture.EMPTY;
  private plumesAnchorX = 0;
  private plumesAnchorY = 0;
  private plumesScale = 1;
  private plumesSpawned = false;

  // Projectile path tracking
  private shootStartX = 0;
  private shootStartY = 0;
  private shootEndX = 0;
  private shootEndY = 0;

  // AS frame 289 (0-indexed: 288) is where the projectile stops
  private readonly ARRIVE_FRAME = 288;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.shootStartX = 0;
    this.shootStartY = init.casterY;
    this.shootEndX = init.targetX;
    this.shootEndY = init.targetY;

    // --- Fumee container (rendered below shoot) ---
    this.fumeeContainer = new Container();
    this.container.addChild(this.fumeeContainer);

    // --- Shoot animation ---
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        anchorX: shootAnchor.x,
        anchorY: shootAnchor.y,
        scale: init.scale,
      })
    );
    this.shootAnim.sprite.position.set(this.shootStartX, this.shootStartY);

    // Frame 0 (AS frame_1 DoAction): SOMA.playSound("crockette_207")
    this.shootAnim.onFrame(0, () => this.callbacks.playSound("crockette_207"));

    // Frame 288 (AS frame 289 DoAction): stop() + _parent.removeMovieClip()
    // Signal hit and spawn plumes when projectile arrives
    this.shootAnim.stopAt(288);
    this.shootAnim.onFrame(288, () => {
      this.signalHit();
      this.spawnPlumes();
    });

    this.container.addChild(this.shootAnim.sprite);

    // --- Prepare fumee resources ---
    this.fumeeTextures = textures.getFrames("lib_fumee");
    const fumeeAnchor = calculateAnchor(FUMEE_MANIFEST);
    this.fumeeAnchorX = fumeeAnchor.x;
    this.fumeeAnchorY = fumeeAnchor.y;
    this.fumeeScale = init.scale;

    // --- Plumes container (rendered above shoot) ---
    this.plumesContainer = new Container();
    this.container.addChild(this.plumesContainer);

    // Prepare plumes resources
    const plumesFrames = textures.getFrames("lib_plumes");
    this.plumesTexture =
      plumesFrames.length > 0 ? plumesFrames[0] : Texture.EMPTY;
    const plumesAnchor = calculateAnchor(PLUMES_MANIFEST);
    this.plumesAnchorX = plumesAnchor.x;
    this.plumesAnchorY = plumesAnchor.y;
    this.plumesScale = init.scale;
  }

  /**
   * Get interpolated projectile position at a given frame.
   * Travels linearly from caster to target over ARRIVE_FRAME frames.
   */
  private getPositionAtFrame(frame: number): { x: number; y: number } {
    const progress = Math.min(frame / this.ARRIVE_FRAME, 1);
    return {
      x: this.shootStartX + (this.shootEndX - this.shootStartX) * progress,
      y: this.shootStartY + (this.shootEndY - this.shootStartY) * progress,
    };
  }

  /**
   * Spawn a fumee smoke particle at the given position.
   * Replicates DefineSprite_15_move onEnterFrame:
   *   this._parent.attachMovie("fumee", "fumee" + c, c + 10);
   *   _loc2_._x = this._x;
   *   _loc2_._y = this._y;
   *   _loc2_.vx = this._x - xi + 20 * (Math.random() - 0.5);
   *   _loc2_.vy = this._y - yi + 20 * (Math.random() - 0.5);
   *
   * Note: vx/vy are stored on the fumee clip but the fumee plays its own
   * pre-baked animation (DefineSprite_19_fumee) without positional physics.
   * Only the spawn position matters here.
   */
  private spawnFumeeAt(x: number, y: number): void {
    if (this.fumeeTextures.length === 0) {
      return;
    }

    const inst = new FumeeInstance(
      this.fumeeTextures,
      this.fumeeAnchorX,
      this.fumeeAnchorY,
      this.fumeeScale
    );
    inst.anim.sprite.position.set(x, y);
    this.fumeeContainer.addChild(inst.anim.sprite);
    this.fumeeInstances.push(inst);
  }

  /**
   * Spawn 10 plumes at impact location.
   *
   * Replicates DefineSprite_2 frame_1:
   *   c = 0; p = 0;
   *   while(p < 10) {
   *     this.attachMovie("plumes","plumes" + c, c);
   *     eval("this.plumes" + c).vx = 40 * (Math.random() - 0.5);
   *     eval("this.plumes" + c).vy = 40 * (Math.random() - 0.5);
   *     c++; p++;
   *   }
   *
   * DefineSprite_6_plumes onClipEvent(load):
   *   t = 30 + random(30); _xscale = t; _yscale = t;
   *   duree = 60 + random(30);
   *   vy = -3 - 10 * Math.random();   ← overridden by outer vy from DefineSprite_2
   *   vx = -10 + 20 * Math.random();  ← overridden by outer vx from DefineSprite_2
   *   vch = 0.1 + 0.1 * Math.random();
   *   vr = 0.1 + 0.1 * Math.random();
   *   amp = 30 + random(70);
   *   a = 0; time = 0;
   *
   * DefineSprite_6_plumes onClipEvent(enterFrame):
   *   if(time++ > duree) { _alpha -= 3; }
   *   if(_Y < 0) {
   *     _Y += (vy += vch);
   *     _X += vx;
   *     vy *= 0.9; vx *= 0.9;
   *     amp *= 0.98;
   *     _rotation = amp * Math.cos(a += vr);
   *   }
   */
  private spawnPlumes(): void {
    if (this.plumesSpawned) {
      return;
    }

    this.plumesSpawned = true;

    const impactX = this.shootEndX;
    const impactY = this.shootEndY;

    for (let p = 0; p < 10; p++) {
      // DefineSprite_2 frame_1: outer vx/vy override the inner ones from plumes load
      const outerVx = 40 * (Math.random() - 0.5);
      const outerVy = 40 * (Math.random() - 0.5);

      // DefineSprite_6_plumes onClipEvent(load):
      const t = 30 + Math.floor(Math.random() * 30);
      const duree = 60 + Math.floor(Math.random() * 30);
      const vch = 0.1 + 0.1 * Math.random();
      const vr = 0.1 + 0.1 * Math.random();
      const amp = 30 + Math.floor(Math.random() * 70);

      const sprite = new Sprite(this.plumesTexture);
      sprite.anchor.set(this.plumesAnchorX, this.plumesAnchorY);
      sprite.scale.set((t / 100) * this.plumesScale);
      sprite.position.set(impactX, impactY);

      this.plumesContainer.addChild(sprite);

      this.plumesParticles.push({
        x: impactX,
        y: impactY,
        vx: outerVx,
        vy: outerVy,
        t,
        duree,
        time: 0,
        amp,
        a: 0,
        vch,
        vr,
        alpha: 100,
        sprite,
        alive: true,
      });
    }
  }

  /**
   * Update plumes physics each frame.
   * Replicates DefineSprite_6_plumes onClipEvent(enterFrame):
   *   if(time++ > duree) { _alpha -= 3; }
   *   if(_Y < 0) {
   *     _Y += (vy += vch);
   *     _X += vx;
   *     vy *= 0.9; vx *= 0.9;
   *     amp *= 0.98;
   *     _rotation = amp * Math.cos(a += vr);
   *   }
   */
  private updatePlumes(): void {
    for (const p of this.plumesParticles) {
      if (!p.alive) {
        continue;
      }

      if (p.time++ > p.duree) {
        p.alpha -= 3;
        p.sprite.alpha = Math.max(0, p.alpha / 100);
      }

      // Flash _Y < 0 means the clip is above the parent origin (Y axis inverted)
      if (p.y < 0) {
        p.vy += p.vch;
        p.y += p.vy;
        p.x += p.vx;
        p.vy *= 0.9;
        p.vx *= 0.9;
        p.amp *= 0.98;
        p.a += p.vr;
        p.sprite.rotation = (p.amp * Math.cos(p.a) * Math.PI) / 180;
        p.sprite.position.set(p.x, p.y);
      }

      if (p.alpha <= 0) {
        p.alive = false;
        p.sprite.visible = false;
      }
    }
  }

  private allPlumesGone(): boolean {
    if (!this.plumesSpawned) {
      return true;
    }

    return this.plumesParticles.every((p) => !p.alive);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    const prevFrame = this.shootAnim.getFrame();
    this.anims.update(deltaTime);
    const curFrame = this.shootAnim.getFrame();

    // Update projectile position
    const curPos = this.getPositionAtFrame(curFrame);
    this.shootAnim.sprite.position.set(curPos.x, curPos.y);

    // Spawn fumee along the trail each frame while projectile is in flight
    // Replicates DefineSprite_15_move onEnterFrame which fires every frame
    if (prevFrame < this.ARRIVE_FRAME) {
      this.spawnFumeeAt(curPos.x, curPos.y);
    }

    // Update fumee instances
    for (const inst of this.fumeeInstances) {
      inst.update(deltaTime);
    }

    // Cull dead fumee instances (sprites already hidden)
    this.fumeeInstances = this.fumeeInstances.filter((inst) => !inst.dead);

    // Update plumes physics
    this.updatePlumes();

    // Completion: shoot has stopped (frame 288) AND all plumes gone AND all fumee gone
    if (
      (this.shootAnim.isStopped() || this.shootAnim.isComplete()) &&
      this.allPlumesGone() &&
      this.fumeeInstances.length === 0
    ) {
      this.complete();
    }
  }

  destroy(): void {
    // Destroy fumee instances not managed by this.anims
    for (const inst of this.fumeeInstances) {
      inst.anim.destroy();
    }

    this.fumeeInstances = [];

    // Destroy plumes sprites
    for (const p of this.plumesParticles) {
      p.sprite.destroy();
    }

    this.plumesParticles = [];

    super.destroy();
  }
}
