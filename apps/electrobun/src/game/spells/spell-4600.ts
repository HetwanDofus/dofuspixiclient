/**
 * Spell 4600 - Explosion with smoke particles
 *
 * Components:
 * - shoot (DefineSprite_14_shoot): Main explosion animation at target position
 * - move (DefineSprite_19_move): Invisible mover that tracks position and spawns smoke particles
 * - fumee (DefineSprite_21_fumee): Smoke particles spawned by move each frame
 *
 * Original AS timing:
 * - Frame 1 (shoot): Play sound 'explosion', set rotation=0, store xi/yi
 * - Frame 1 (move): Store xi/yi, spawn fumee particles each frame tracking movement
 * - Frame 1 (fumee): Set random scale (50-100%), goto random frame (0-29), set physics
 * - Frame 46 (fumee): removeMovieClip() - particle dies
 * - Frame 73 (shoot): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container, type Texture } from "pixi.js";

const SHOOT_MANIFEST: SpriteManifest = {
  width: 59.9,
  height: 52.3,
  offsetX: -29.1,
  offsetY: -45.65,
};

const FUMEE_MANIFEST: SpriteManifest = {
  width: 3,
  height: 3.1,
  offsetX: -0.8,
  offsetY: -1.1,
};

/**
 * Extended particle with frame-based animation tracking
 */
interface FumeeParticle {
  anim: FrameAnimatedSprite;
  vx: number;
  vy: number;
  x: number;
  y: number;
}

export class Spell4600 extends BaseSpell {
  readonly spellId = 4600;

  private shootAnim!: FrameAnimatedSprite;
  private fumeeTextures: Texture[] = [];
  private fumeeParticles: FumeeParticle[] = [];
  private fumeeContainer!: Container;
  private fumeeManifestAnchor = { x: 0, y: 0 };

  // Move sprite tracking
  private moveX = 0;
  private moveY = 0;
  private movePrevX = 0;
  private movePrevY = 0;
  private particleCounter = 0;

  // The shoot animation plays through a composite that includes a "move" child
  // We simulate the move child's position by sampling the shoot sprite's implicit
  // trajectory. In AS, the move sprite is placed at coordinates tracked per-frame.
  // Since we have no separate move sprite data, we use the target position as
  // the origin (shoot is at target), and the move sprite starts at that same location.

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Container for smoke particles (below shoot)
    this.fumeeContainer = new Container();
    this.fumeeContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.fumeeContainer);

    // Shoot animation at target position
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
    // AS: _rotation = 0
    this.shootAnim.sprite.rotation = 0;

    // Frame 1 (0-indexed: 0): play sound
    this.shootAnim.onFrame(0, () => this.callbacks.playSound("explosion"));

    // Frame 73 (0-indexed: 72): removeMovieClip -> complete
    this.shootAnim.onFrame(72, () => {
      this.signalHit();
      this.complete();
    });

    this.container.addChild(this.shootAnim.sprite);

    // Store fumee textures for particle spawning
    this.fumeeTextures = textures.getFrames("lib_fumee");
    this.fumeeManifestAnchor = calculateAnchor(FUMEE_MANIFEST);

    // Initialize move position (same as target/shoot position)
    // In AS, the move sprite is at the same location as shoot initially
    this.moveX = 0; // relative to fumeeContainer which is at target
    this.moveY = 0;
    this.movePrevX = 0;
    this.movePrevY = 0;
  }

  private spawnFumeeParticle(): void {
    if (this.fumeeTextures.length === 0) {
      return;
    }

    // AS: t = 50 * Math.random() + 50
    const t = 50 * Math.random() + 50;

    // AS: gotoAndPlay(random(30)) -> 0-indexed: random frame 0-29
    const startFrame = Math.floor(Math.random() * 30);

    // AS: vx = this._x - xi + 20 * (Math.random() - 0.5)
    const rawVx = this.moveX - this.movePrevX + 20 * (Math.random() - 0.5);
    // AS: vy = this._y - yi + 20 * (Math.random() - 0.5)
    const rawVy = this.moveY - this.movePrevY + 20 * (Math.random() - 0.5);

    // AS fumee frame_1: vx /= 3 + 3 * Math.random(); vy /= 3 + random(3)
    const vx = rawVx / (3 + 3 * Math.random());
    const vy = rawVy / (3 + Math.floor(Math.random() * 3));

    const anim = new FrameAnimatedSprite({
      textures: this.fumeeTextures,
      anchorX: this.fumeeManifestAnchor.x,
      anchorY: this.fumeeManifestAnchor.y,
      startFrame,
    });

    // AS: _xscale = t; _yscale = t (t is percentage)
    const scale = t / 100;
    anim.sprite.scale.set(scale);
    anim.sprite.position.set(this.moveX, this.moveY);

    // Frame 46 (0-indexed: 45): removeMovieClip -> mark dead
    const _particleIndex = this.particleCounter;
    anim.stopAt(45);

    this.fumeeContainer.addChild(anim.sprite);

    const particle: FumeeParticle = {
      anim,
      vx,
      vy,
      x: this.moveX,
      y: this.moveY,
    };

    this.fumeeParticles.push(particle);
    this.particleCounter++;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update main shoot animation
    this.anims.update(deltaTime);

    // Spawn fumee particles each frame (nf=1 in AS, so 1 per frame)
    // The move sprite stays at (0,0) relative to fumeeContainer (no movement data)
    // but we still spawn particles with random offsets
    if (!this.shootAnim.isComplete()) {
      this.spawnFumeeParticle();
      // After spawning, update prev position
      this.movePrevX = this.moveX;
      this.movePrevY = this.moveY;
    }

    // Update fumee particles physics
    // AS onEnterFrame: _X += vx; _Y += vy; vx /= 1.08; vy /= 1.08
    const deadIndices: number[] = [];
    for (let i = 0; i < this.fumeeParticles.length; i++) {
      const p = this.fumeeParticles[i];

      if (p.anim.isComplete() || p.anim.isStopped()) {
        deadIndices.push(i);
        continue;
      }

      // Update position
      p.x += p.vx;
      p.y += p.vy;
      p.vx /= 1.08;
      p.vy /= 1.08;

      p.anim.sprite.position.set(p.x, p.y);
      p.anim.update(deltaTime);

      if (p.anim.isComplete() || p.anim.isStopped()) {
        deadIndices.push(i);
      }
    }

    // Remove dead particles (in reverse order to preserve indices)
    for (let i = deadIndices.length - 1; i >= 0; i--) {
      const idx = deadIndices[i];
      const p = this.fumeeParticles[idx];
      p.anim.destroy();
      this.fumeeParticles.splice(idx, 1);
    }
  }

  destroy(): void {
    // Destroy any remaining fumee particles
    for (const p of this.fumeeParticles) {
      p.anim.destroy();
    }
    this.fumeeParticles = [];
    super.destroy();
  }
}
