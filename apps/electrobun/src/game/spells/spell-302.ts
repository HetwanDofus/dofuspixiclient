/**
 * Spell 302 - Setag
 *
 * A star effect spell that spawns 19 "etoiles" (star) instances at the target position.
 * Each star animates independently with randomized positions, start frames, and physics.
 *
 * Components:
 * - 19 etoiles instances (lib_etoiles): Spawned at frame 1, positioned randomly around target
 *
 * Original AS timing:
 * - DefineSprite_9/frame_1: Spawn 19 etoile instances (c=1 while c<20)
 * - DefineSprite_8_etoiles/frame_1: Random X/Y position, random start frame (1-30)
 * - DefineSprite_8_etoiles/frame_88: Stop, init physics, start onEnterFrame movement
 * - DefineSprite_8_etoiles/frame_142: removeMovieClip (star done)
 * - DefineSprite_9/frame_64: Play sound 'setag_302' (0-indexed: 63)
 * - DefineSprite_9/frame_316: this.end() -> signalHit (0-indexed: 315)
 * - DefineSprite_9/frame_349: removeMovieClip -> complete (0-indexed: 348)
 *
 * Each etoile:
 * - Frame 1: _X = 140*(Math.random()-0.5), _Y = 50*(Math.random()-0.5), gotoAndPlay(random(30)+1)
 * - Frame 88: stop(), init physics (accx, accy, vx, vy, tf=90+random(60)), onEnterFrame movement
 * - Frame 142: removeMovieClip
 * - Inner sprite (PlaceObject2_5_2 at frame 28): gotoAndStop(random(_totalframes)+1)
 * - Outer sprite (DefineSprite_5): _alpha = random(100) each frame
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

const ETOILES_MANIFEST: SpriteManifest = {
  width: 65.45,
  height: 65.4,
  offsetX: -32.3,
  offsetY: -41.7,
};

/**
 * Represents one etoile instance with its physics state.
 * Models DefineSprite_8_etoiles behavior.
 */
interface EtoileInstance {
  anim: FrameAnimatedSprite;
  /** Local position relative to parent container */
  x: number;
  y: number;
  vx: number;
  vy: number;
  accx: number;
  accy: number;
  t: number;
  tf: number;
  end: number;
  /** Whether physics (onEnterFrame) has been activated */
  physicsActive: boolean;
  /** Whether this etoile has been removed */
  removed: boolean;
}

export class Spell302 extends BaseSpell {
  readonly spellId = 302;

  private etoilesContainer!: Container;
  private etoiles: EtoileInstance[] = [];

  // Main timeline frame counter (DefineSprite_9)
  private mainFrameTime = 0;
  private mainFrame = 0;
  private readonly FRAME_TIME = 1000 / 60;
  private soundPlayed = false;
  private hitSignaledAt315 = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Container positioned at target cell
    this.etoilesContainer = new Container();
    this.etoilesContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.etoilesContainer);

    const etoilesTextures = textures.getFrames("lib_etoiles");
    const anchor = calculateAnchor(ETOILES_MANIFEST);

    // DefineSprite_9/frame_1: c=1; while(c < 20) -> 19 instances
    for (let c = 1; c < 20; c++) {
      // DefineSprite_8_etoiles/frame_1:
      // _X = 140 * (Math.random() - 0.5)
      // _Y = 50 * (Math.random() - 0.5)
      // gotoAndPlay(random(30) + 1) -> 0-indexed: random(30) -> startFrame 0-29
      const x = 140 * (Math.random() - 0.5);
      const y = 50 * (Math.random() - 0.5);
      const startFrame = Math.floor(Math.random() * 30);

      const anim = new FrameAnimatedSprite({
        textures: etoilesTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: init.scale,
        startFrame: startFrame,
      });

      anim.sprite.position.set(x, y);
      this.etoilesContainer.addChild(anim.sprite);

      // Note: We do NOT register with this.anims.add() because we manage these manually
      // (they have per-instance physics and removal logic)

      const etoile: EtoileInstance = {
        anim,
        x,
        y,
        vx: 0,
        vy: 0,
        accx: 0,
        accy: 0,
        t: 0,
        tf: 0,
        end: 0,
        physicsActive: false,
        removed: false,
      };

      this.etoiles.push(etoile);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Advance main timeline (DefineSprite_9)
    this.mainFrameTime += deltaTime;
    while (this.mainFrameTime >= this.FRAME_TIME) {
      this.mainFrameTime -= this.FRAME_TIME;
      this.mainFrame++;

      // DefineSprite_9/frame_64 (0-indexed: 63): play sound
      if (this.mainFrame === 63 && !this.soundPlayed) {
        this.soundPlayed = true;
        this.callbacks.playSound("setag_302");
      }

      // DefineSprite_9/frame_316 (0-indexed: 315): this.end() -> signalHit
      if (this.mainFrame === 315 && !this.hitSignaledAt315) {
        this.hitSignaledAt315 = true;
        this.signalHit();
      }

      // DefineSprite_9/frame_349 (0-indexed: 348): removeMovieClip -> complete
      if (this.mainFrame >= 348) {
        this.complete();
        return;
      }
    }

    // Update each etoile instance
    for (const etoile of this.etoiles) {
      if (etoile.removed) {
        continue;
      }

      // Advance the animation frame
      etoile.anim.update(deltaTime);

      const currentFrame = etoile.anim.getFrame();

      // DefineSprite_8_etoiles/frame_88 (0-indexed: 87):
      // Activate physics if we just reached frame 87 and physics not yet active
      if (currentFrame >= 87 && !etoile.physicsActive) {
        etoile.physicsActive = true;
        // stop() - handled by the animation reaching frame 141 (stopAt)
        // init physics:
        // accx = 0.1 + 0.1 * Math.random()
        // accy = 0.05
        // t = 0
        // tf = 90 + random(60)
        // vx = 0
        // vy = -3 - 10 * Math.random()
        // end = 0
        etoile.accx = 0.1 + 0.1 * Math.random();
        etoile.accy = 0.05;
        etoile.t = 0;
        etoile.tf = 90 + Math.floor(Math.random() * 60);
        etoile.vx = 0;
        etoile.vy = -3 - 10 * Math.random();
        etoile.end = 0;

        // Stop animation at frame 87 (it called stop() in AS)
        // We pause here; it will resume when t > tf
        etoile.anim.pause();
      }

      // DefineSprite_8_etoiles/frame_142 (0-indexed: 141): removeMovieClip
      if (currentFrame >= 141) {
        etoile.removed = true;
        etoile.anim.sprite.visible = false;
        continue;
      }

      // Run onEnterFrame physics if active and not yet resumed
      if (etoile.physicsActive) {
        // AS onEnterFrame:
        // if(_X < 0) { vx += accx; }
        // if(_X > 0) { vx -= accx; }
        // if(_Y < -20) { vy += accy; }
        // if(_Y > -20) { vy -= accy; }
        // _X = _X + vx
        // _Y = _Y + vy
        // vx *= 0.9999
        // vy *= 0.9555
        // if(t++ > tf & end != 1) { play(); end = 1; }

        if (etoile.x < 0) {
          etoile.vx += etoile.accx;
        }
        if (etoile.x > 0) {
          etoile.vx -= etoile.accx;
        }
        if (etoile.y < -20) {
          etoile.vy += etoile.accy;
        }
        if (etoile.y > -20) {
          etoile.vy -= etoile.accy;
        }

        etoile.x = etoile.x + etoile.vx;
        etoile.y = etoile.y + etoile.vy;
        etoile.vx *= 0.9999;
        etoile.vy *= 0.9555;

        etoile.anim.sprite.position.set(etoile.x, etoile.y);

        // t++ > tf (post-increment: check t, then increment)
        if (etoile.t > etoile.tf && etoile.end !== 1) {
          etoile.anim.play();
          etoile.end = 1;
        }
        etoile.t++;
      }

      // Random alpha flicker (DefineSprite_5 onClipEvent enterFrame: _alpha = random(100))
      // Applied to the whole etoile sprite to simulate the inner flicker
      etoile.anim.sprite.alpha = Math.floor(Math.random() * 100) / 100;
    }
  }

  destroy(): void {
    for (const etoile of this.etoiles) {
      etoile.anim.destroy();
    }
    this.etoiles = [];
    super.destroy();
  }
}
