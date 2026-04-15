/**
 * Spell 202 - Crockette (Sadida)
 *
 * An earth/nature spell with star (etoiles) particles that float and settle.
 *
 * Components:
 * - etoiles: 51-frame star animation played at target position
 *   - Frame 1: Random initial position (±70x, ±25y), random start frame (1-10)
 *   - Frame 33: Stop, begin floating physics toward (-20y), then play again
 *   - Frame 51: Remove (end)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'crockette_202'
 * - Frame 33 (etoiles): stop(), begin onEnterFrame physics
 * - Frame 51 (etoiles): removeMovieClip / stop - animation ends
 * - Frame 97 (DefineSprite_31): this.end() - hit signal
 *
 * Note: The main timeline (DefineSprite_31) signals hit at frame 97.
 * The etoiles animation is 51 frames. Multiple etoiles instances are spawned.
 * The "or" (gold) and "pierres" (rocks) particle systems are also present but
 * the etoiles sprite sheet is the primary exported animation.
 */

import { Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ETOILES_MANIFEST: SpriteManifest = {
  width: 65.45,
  height: 65.4,
  offsetX: -32.3,
  offsetY: -41.7,
};

// Number of star instances to spawn (approximating the AS scene)
const ETOILE_COUNT = 8;

interface EtoileState {
  anim: FrameAnimatedSprite;
  // Physics state from frame_33/DoAction.as
  x: number;
  y: number;
  vx: number;
  vy: number;
  accx: number;
  accy: number;
  tf: number;
  t: number;
  end: number;
  physicsActive: boolean;
  removed: boolean;
}

export class Spell202 extends BaseSpell {
  readonly spellId = 202;

  private etoilesContainer!: Container;
  private etoileStates: EtoileState[] = [];
  private hitSignaledFrame = 0;
  private elapsedFrames = 0;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // Play sound at frame 1 (index 0)
    this.callbacks.playSound('crockette_202');

    const etoilesTextures = textures.getFrames('etoiles');
    const anchor = calculateAnchor(ETOILES_MANIFEST);

    this.etoilesContainer = new Container();
    this.etoilesContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.etoilesContainer);

    for (let i = 0; i < ETOILE_COUNT; i++) {
      // AS frame_1/DoAction.as:
      // _X = 140 * (math.random() - 0.5);
      // _Y = 50 * (math.random() - 0.5);
      // gotoAndPlay(random(10) + 1);  -> 0-indexed: random(10) + 0 = 0..9, but +1 in AS means frames 1..10 -> 0-indexed 0..9
      const startX = 140 * (Math.random() - 0.5);
      const startY = 50 * (Math.random() - 0.5);
      const startFrame = Math.floor(Math.random() * 10); // random(10) + 1 in AS = frames 1-10, 0-indexed: 0-9

      const anim = this.anims.add(new FrameAnimatedSprite({
        textures: etoilesTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        startFrame,
        fps: 60,
        loop: false,
      }));

      anim.sprite.position.set(startX * init.scale, startY * init.scale);

      const state: EtoileState = {
        anim,
        x: startX * init.scale,
        y: startY * init.scale,
        vx: 0,
        vy: 0,
        accx: 0,
        accy: 0,
        tf: 0,
        t: 0,
        end: 0,
        physicsActive: false,
        removed: false,
      };

      // At frame 32 (0-indexed for AS frame 33): stop and begin physics
      anim.onFrame(32, () => {
        this.activateEtoilePhysics(state);
      });

      // At frame 50 (0-indexed for AS frame 51): removeMovieClip
      anim.onFrame(50, () => {
        state.removed = true;
        anim.sprite.visible = false;
      });

      this.etoilesContainer.addChild(anim.sprite);
      this.etoileStates.push(state);
    }
  }

  private activateEtoilePhysics(state: EtoileState): void {
    // AS frame_33/DoAction.as:
    // stop();
    // accx = 0.3 + 0.3 * Math.random();
    // accy = 0.3;
    // tf = 30 + random(30);
    // vy = -3 - 10 * Math.random();
    state.accx = 0.3 + 0.3 * Math.random();
    state.accy = 0.3;
    state.tf = 30 + Math.floor(Math.random() * 30);
    state.vy = -3 - 10 * Math.random();
    state.vx = 0;
    state.t = 0;
    state.end = 0;
    state.physicsActive = true;
  }

  private updateEtoilePhysics(state: EtoileState): void {
    if (!state.physicsActive || state.removed) {
      return;
    }

    // AS onEnterFrame from frame_33/DoAction.as:
    // if(_X < 0) { vx += accx; }
    // if(_X > 0) { vx -= accx; }
    // if(_Y < -20) { vy += accy; }
    // if(_Y > -20) { vy -= accy; }
    // _X = _X + vx;
    // _Y = _Y + vy;
    // vx *= 0.99;
    // vy *= 0.95;
    // if(t++ > tf & end != 1) { play(); end = 1; }

    // In AS, _X/_Y are local coords of the etoiles clip itself
    // We track in local space (before scale)
    const localX = state.x / (state.anim.sprite.scale.x !== 0 ? state.anim.sprite.scale.x : 1);
    const localY = state.y / (state.anim.sprite.scale.y !== 0 ? state.anim.sprite.scale.y : 1);

    if (localX < 0) {
      state.vx += state.accx;
    }
    if (localX > 0) {
      state.vx -= state.accx;
    }
    if (localY < -20) {
      state.vy += state.accy;
    }
    if (localY > -20) {
      state.vy -= state.accy;
    }

    state.x += state.vx;
    state.y += state.vy;
    state.vx *= 0.99;
    state.vy *= 0.95;

    state.anim.sprite.position.set(state.x, state.y);

    // AS uses bitwise & (not &&), so both sides always evaluated
    const tExceeded = state.t++ > state.tf;
    const notEnd = state.end !== 1;
    if (tExceeded && notEnd) {
      state.anim.play();
      state.end = 1;
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update physics for etoile instances that are in floating mode
    for (const state of this.etoileStates) {
      this.updateEtoilePhysics(state);
    }

    // Track elapsed time for hit signal (DefineSprite_31 frame 97 -> 0-indexed 96)
    this.elapsedFrames += deltaTime / (1000 / 60);
    if (this.elapsedFrames >= 96) {
      this.signalHit();
    }

    // Check if all etoiles are done (removed or complete)
    const allDone = this.etoileStates.every(state => {
      return state.removed || state.anim.isComplete();
    });

    if (allDone) {
      this.complete();
    }
  }
}
