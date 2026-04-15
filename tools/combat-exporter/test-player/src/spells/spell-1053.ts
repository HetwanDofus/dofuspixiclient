/**
 * Spell 1053 - Sacrieur (Blood/Sacrifice spell)
 *
 * A projectile spell that shoots a "move" sprite from caster to target,
 * trailing "spire" particles, with a "shoot" impact animation at the target.
 *
 * Components:
 * - shoot (DefineSprite_12): Impact at target position, 81 frames, stops at frame 51
 * - move (DefineSprite_15): Projectile looping frames 3-6, spawning 2 spires/frame
 * - spire (lib_spire): Trail particles with AS physics
 *
 * Original AS timing:
 * - shoot frame 1: _rotation=0; this.end() → signal hit immediately
 * - shoot frame 4: SOMA.playSound("sacrieur_1053")
 * - shoot frame 52: _parent.removeMovieClip() → animation ends (stopAt 51)
 * - move frame 1: setup onEnterFrame spawning 2 spires per frame; play()
 * - move frame 7: gotoAndPlay(4) → loops 4-7 (0-indexed: 3-6)
 * - spire load: va=1.5+random(5), _alpha=50+random(50), _xscale=200,
 *               _yscale=80+random(40), v=1+2.5*Math.random()
 * - spire enterFrame: _xscale*=0.97, _X-=(v*=0.9), _alpha-=va; die if _alpha<0
 */

import { Sprite, Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SHOOT_MANIFEST: SpriteManifest = {
  width: 150.75,
  height: 196.2,
  offsetX: -72.05,
  offsetY: -138.2,
};

const MOVE_MANIFEST: SpriteManifest = {
  width: 48.9,
  height: 19.4,
  offsetX: -43.95,
  offsetY: -8.95,
};

const SPIRE_MANIFEST: SpriteManifest = {
  width: 22.4,
  height: 8.4,
  offsetX: -11.25,
  offsetY: -4.2,
};

interface SpireParticle {
  sprite: Sprite;
  /** AS: va = 1.5 + random(5) — alpha decay per frame */
  va: number;
  /** AS: _alpha stored as 0-100 */
  alpha: number;
  /** AS: _xscale stored as percentage (starts at 200) */
  xscale: number;
  /** AS: _yscale stored as percentage (80+random(40)) — constant */
  yscale: number;
  /** AS: v = velocity, decays each frame by *0.9 */
  v: number;
  /** World X position */
  x: number;
  /** World Y position */
  y: number;
  /** Rotation in radians (same as move sprite's rotation when spawned) */
  rotationRad: number;
  alive: boolean;
}

export class Spell1053 extends BaseSpell {
  readonly spellId = 1053;

  private shootAnim!: FrameAnimatedSprite;
  private moveAnim!: FrameAnimatedSprite;
  private spireContainer!: Container;
  private spireParticles: SpireParticle[] = [];
  private spireTextures: Texture[] = [];
  /** Counter c used in AS for attaching movie clips */
  private spireC = 1;
  /** Whether the move sprite is actively spawning spires */
  private moveSpawning = false;
  private extractionScale = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.extractionScale = init.scale;

    // Container for spire particles (rendered below move sprite)
    this.spireContainer = new Container();
    this.container.addChild(this.spireContainer);

    // Load spire textures from library symbol
    this.spireTextures = textures.getFrames('lib_spire');

    // --- shoot animation at target position ---
    const shootAnchor = calculateAnchor(SHOOT_MANIFEST);
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      scale: init.scale,
      stopFrame: 51, // AS frame 52 = index 51
    }));
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // AS frame 1 = index 0: _rotation = 0; this.end() → signal hit
    this.shootAnim.onFrame(0, () => {
      this.signalHit();
    });

    // AS frame 4 = index 3: SOMA.playSound("sacrieur_1053")
    this.shootAnim.onFrame(3, () => {
      this.callbacks.playSound('sacrieur_1053');
    });

    this.container.addChild(this.shootAnim.sprite);

    // --- move animation (projectile) at caster, rotated toward target ---
    const moveAnchor = calculateAnchor(MOVE_MANIFEST);
    this.moveAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('move'),
      fps: 60,
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
      scale: init.scale,
      loop: true,
    }));
    this.moveAnim.sprite.position.set(0, init.casterY);
    this.moveAnim.sprite.rotation = init.angleRad;

    // AS frame 1 = index 0: set up onEnterFrame spawning; play()
    this.moveAnim.onFrame(0, () => {
      this.moveSpawning = true;
    });

    // AS frame 7 = index 6: gotoAndPlay(4) → jump to index 3
    this.moveAnim.onFrame(6, () => {
      this.moveAnim.gotoFrame(3);
    });

    this.container.addChild(this.moveAnim.sprite);
  }

  private spawnSpires(): void {
    // AS: t = 1; while(t <= 2) { ... c++; t++; } → spawns exactly 2 spires
    for (let t = 1; t <= 2; t++) {
      this.spawnOneSpire();
      this.spireC++;
    }
  }

  private spawnOneSpire(): void {
    if (this.spireTextures.length === 0) {
      return;
    }

    // AS load:
    // va = 1.5 + random(5) — random(5) returns 0..4
    const va = 1.5 + Math.floor(Math.random() * 5);

    // _alpha = 50 + random(50) — returns 50..99
    const alphaAS = 50 + Math.floor(Math.random() * 50);

    // _xscale = 200
    const xscaleAS = 200;

    // _yscale = 80 + random(40) — returns 80..119
    const yscaleAS = 80 + Math.floor(Math.random() * 40);

    // v = 1 + 2.5 * Math.random()
    const v = 1 + 2.5 * Math.random();

    // if (_parent.c % 2 == 0) gotoAndStop(2) else gotoAndStop(1)
    // AS gotoAndStop(2) = frame index 1; gotoAndStop(1) = frame index 0
    let frameIndex: number;
    if (this.spireC % 2 === 0) {
      frameIndex = 1;
    } else {
      frameIndex = 0;
    }

    const texture = this.spireTextures[Math.min(frameIndex, this.spireTextures.length - 1)] ?? Texture.EMPTY;
    const spireAnchor = calculateAnchor(SPIRE_MANIFEST);

    const sprite = new Sprite(texture);
    sprite.anchor.set(spireAnchor.x, spireAnchor.y);

    // Position at move sprite's current screen position
    const moveSprite = this.moveAnim.sprite;
    const wx = moveSprite.x;
    const wy = moveSprite.y;
    const rotRad = moveSprite.rotation;

    sprite.position.set(wx, wy);
    sprite.rotation = rotRad;
    // Apply scales: xscale=200% → 2.0, yscale=e.g.90% → 0.9, multiplied by extraction scale
    sprite.scale.set(
      (xscaleAS / 100) * this.extractionScale,
      (yscaleAS / 100) * this.extractionScale,
    );
    sprite.alpha = alphaAS / 100;

    this.spireContainer.addChild(sprite);

    this.spireParticles.push({
      sprite,
      va,
      alpha: alphaAS,
      xscale: xscaleAS,
      yscale: yscaleAS,
      v,
      x: wx,
      y: wy,
      rotationRad: rotRad,
      alive: true,
    });
  }

  private updateSpireParticles(): void {
    for (const p of this.spireParticles) {
      if (!p.alive) {
        continue;
      }

      // AS: _xscale = _xscale * 0.97
      p.xscale = p.xscale * 0.97;

      // AS: _X = _X - (v *= 0.9)
      // The spire is placed in the same parent space as the move clip.
      // Moving _X decreases X along the spire's local rotation direction.
      p.v *= 0.9;
      p.x -= p.v * Math.cos(p.rotationRad);
      p.y -= p.v * Math.sin(p.rotationRad);

      // AS: _alpha = _alpha - va
      p.alpha -= p.va;

      // Apply to sprite
      p.sprite.scale.set(
        (p.xscale / 100) * this.extractionScale,
        (p.yscale / 100) * this.extractionScale,
      );
      p.sprite.position.set(p.x, p.y);
      p.sprite.alpha = Math.max(0, p.alpha / 100);

      // AS: if (_alpha < 0) _parent.removeMovieClip()
      if (p.alpha < 0) {
        p.alive = false;
        p.sprite.visible = false;
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Spawn spires every frame while move is active
    if (this.moveSpawning && !this.moveAnim.isComplete()) {
      this.spawnSpires();
    }

    // Update spire particle physics
    this.updateSpireParticles();

    // Complete when shoot is stopped/done AND no alive spires remain
    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      const hasAlive = this.spireParticles.some(p => p.alive);
      if (!hasAlive) {
        this.complete();
      }
    }
  }

  destroy(): void {
    for (const p of this.spireParticles) {
      p.sprite.destroy();
    }
    this.spireParticles = [];
    this.spireContainer.destroy({ children: false });
    super.destroy();
  }
}
