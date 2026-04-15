/**
 * Spell 501 - Many (Sacrieur Earth)
 *
 * A ground-based rock/earth spell with:
 * - shoot: Main shoot animation at caster position (168 frames, stops at 165)
 * - 10 "pierres" (stones) particles with AS physics, each containing 1 "effet" sub-animation
 * - Sound at frame 0 of shoot
 *
 * Components:
 * - shoot (sprite_10): At target position, plays full animation
 * - 10 pierres particles with bouncing physics
 * - Each pierre has 1 effet sub-sprite (27-frame animation, random start frame)
 *
 * Original AS timing:
 * - Frame 1 (shoot): Play sound 'many_501'
 * - Frame 166 (shoot): removeMovieClip / stop -> animation ends
 * - Each pierre: bouncing physics with gravity, bounce damping, stops when settled
 * - Each effet: random X/Y offset (-15..15, -5..5), random start frame (1-10), stops at frame 25
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
  width: 151.65,
  height: 106.55,
  offsetX: -76.3,
  offsetY: -68.1,
};

const EFFET_MANIFEST: SpriteManifest = {
  width: 39.45,
  height: 39.6,
  offsetX: -18.8,
  offsetY: -40.2,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 6.4,
  height: 4.55,
  offsetX: -3.2,
  offsetY: -2.2,
};

/**
 * A single "pierre" (stone) particle with its own "effet" sub-animation.
 * Implements the AS physics from DefineSprite_13_pierres enterFrame.
 */
interface Pierre {
  /** Container holding the pierre sprite + effet */
  container: Container;
  /** The pierre sprite animation */
  pierreAnim: FrameAnimatedSprite;
  /** The effet sub-animation */
  effetAnim: FrameAnimatedSprite;

  // Physics state (from onClipEvent load)
  c: number;
  tps: number;
  vx: number;
  vy: number;
  t: number;
  v: number;
  vr: number;
  // _Y of the pierre sprite (vertical position within container)
  localY: number;
  // _rotation of the pierre sprite
  localRotation: number;
}

export class Spell501 extends BaseSpell {
  readonly spellId = 501;

  private shootAnim!: FrameAnimatedSprite;
  private pierres: Pierre[] = [];
  private pierresContainer!: Container;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // ---- Shoot animation (sprite_10 / DefineSprite_10_shoot) ----
    // Positioned at target, no rotation needed (earth spell)
    this.shootAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('shoot'),
      fps: 60,
      ...calculateAnchor(SHOOT_MANIFEST),
      scale: init.scale,
    }));
    this.shootAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): play sound
    this.shootAnim.onFrame(0, () => this.callbacks.playSound('many_501'));

    // Frame 166 (0-indexed: 165): animation ends (removeMovieClip)
    // The shoot animation naturally completes at frame 167 (index), but AS stops at 166
    // DefineSprite_10_shoot has 168 frames; frame 166 (1-indexed) = index 165
    this.shootAnim.stopAt(165);

    this.container.addChild(this.shootAnim.sprite);

    // ---- Pierres container (positioned at target) ----
    this.pierresContainer = new Container();
    this.pierresContainer.scale.set(init.scale);
    this.pierresContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.pierresContainer);

    const pierreTextures = textures.getFrames('lib_pierres');
    const effetTextures = textures.getFrames('lib_effet');
    const pierreAnchor = calculateAnchor(PIERRES_MANIFEST);
    const effetAnchor = calculateAnchor(EFFET_MANIFEST);

    // DefineSprite_7 / PlaceObject2_6_1 onClipEvent(load): attach 10 pierres
    for (let i = 0; i < 10; i++) {
      // ---- Pierre physics init (DefineSprite_13_pierres onClipEvent load) ----
      const vx = 5 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);
      const parentX = 20 * (Math.random() - 0.5);
      const parentY = 10 * (Math.random() - 0.5);
      const t = 60 + 40 * Math.random();
      const alpha = (20 + Math.floor(Math.random() * 90)) / 100;
      const v = -15 * Math.random() - 5;
      const vr = 140 * (-0.5 + Math.random());

      // Pierre container (this is _parent in AS context)
      const pierreContainer = new Container();
      pierreContainer.position.set(parentX, parentY);
      this.pierresContainer.addChild(pierreContainer);

      // Pierre sprite
      const pierreAnim = new FrameAnimatedSprite({
        textures: pierreTextures,
        fps: 60,
        anchorX: pierreAnchor.x,
        anchorY: pierreAnchor.y,
      });
      pierreAnim.sprite.scale.set(t / 100);
      pierreAnim.sprite.alpha = alpha;
      pierreAnim.sprite.position.set(0, 0);
      pierreContainer.addChild(pierreAnim.sprite);

      // ---- Effet sub-animation (DefineSprite_14_duplicate attaches 1 effet) ----
      // DefineSprite_3_effet frame_1 DoAction:
      //   _X = 30 * (-0.5 + Math.random())
      //   _Y = 10 * (-0.5 + Math.random())
      //   gotoAndPlay(random(10) + 1)  -> 0-indexed: startFrame = random(10) + 0 = 0..9
      const effetX = 30 * (-0.5 + Math.random());
      const effetY = 10 * (-0.5 + Math.random());
      const effetStartFrame = Math.floor(Math.random() * 10); // random(10) + 1, 0-indexed = 0..9

      const effetAnim = new FrameAnimatedSprite({
        textures: effetTextures,
        fps: 60,
        anchorX: effetAnchor.x,
        anchorY: effetAnchor.y,
        startFrame: effetStartFrame,
      });
      effetAnim.sprite.position.set(effetX, effetY);
      // Stop at frame 25 (1-indexed) = index 24
      effetAnim.stopAt(24);
      pierreContainer.addChild(effetAnim.sprite);

      const pierre: Pierre = {
        container: pierreContainer,
        pierreAnim,
        effetAnim,
        c: 0,
        tps: 1,
        vx,
        vy,
        t,
        v,
        vr,
        localY: 0,
        localRotation: 0,
      };

      this.pierres.push(pierre);
    }

    // Signal hit when shoot animation reaches a reasonable midpoint
    // The shoot animation is the main one; signal hit at start (frame 0) since it's an earth spell
    // Looking at the AS: there's no explicit "end()" call, the shoot just plays to 166.
    // We signal hit at frame 0 (instant hit) since it's a ground effect with no projectile travel
    this.signalHit();
  }

  private updatePierre(pierre: Pierre, _deltaTime: number): void {
    // AS enterFrame physics (runs every frame, not deltaTime-scaled):
    // We treat each update call as one frame tick (deltaTime-independent per AS behavior)
    pierre.c++;

    if (pierre.c === 10) {
      pierre.tps = 0.15;
    }

    if (pierre.c === 75) {
      pierre.tps = 1;
    }

    pierre.container.x += pierre.vx * pierre.tps;
    pierre.container.y += pierre.vy * pierre.tps;

    if (pierre.t !== 1) {
      pierre.localY += pierre.v * pierre.tps;
      pierre.localRotation += pierre.vr * pierre.tps;
      pierre.v += 0.75 * pierre.tps;

      if (pierre.localY > 0) {
        pierre.vx /= 2;
        pierre.vy /= 5;
        pierre.localRotation = 0;
        pierre.localY = 0;
        pierre.v = (-pierre.v) / 4;

        if (Math.abs(pierre.v) < 1) {
          pierre.vx = 0;
          pierre.vy = 0;
          pierre.t = 1;
        }
      }

      // Apply local position and rotation to the pierre sprite
      pierre.pierreAnim.sprite.position.set(0, pierre.localY);
      pierre.pierreAnim.sprite.rotation = (pierre.localRotation * Math.PI) / 180;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update shoot animation
    this.shootAnim.update(deltaTime);

    // Update each pierre's physics and animations
    // AS runs physics every enterFrame (every frame at 60fps)
    // We accumulate deltaTime and run physics ticks
    for (const pierre of this.pierres) {
      this.updatePierre(pierre, deltaTime);
      pierre.pierreAnim.update(deltaTime);
      pierre.effetAnim.update(deltaTime);
    }

    // Completion: shoot animation done (stopped at frame 165)
    if (this.shootAnim.isStopped() || this.shootAnim.isComplete()) {
      // Check all effet animations are also done
      const allEffetsDone = this.pierres.every(p => p.effetAnim.isStopped() || p.effetAnim.isComplete());

      if (allEffetsDone) {
        this.complete();
      }
    }
  }

  destroy(): void {
    // Clean up pierre sprites not managed by this.anims
    for (const pierre of this.pierres) {
      pierre.pierreAnim.destroy();
      pierre.effetAnim.destroy();
    }
    this.pierres = [];
    super.destroy();
  }
}
