/**
 * Spell 507 - Many (Sadida)
 *
 * A target-based spell with multiple "etoiles" (star) instances spawned at frame 7.
 * 58 etoiles (indices 2-59) are attached, each with randomized position, scale,
 * alpha, and animation start frame.
 *
 * Components:
 * - etoiles (lib_etoiles): 58 instances spawned at frame 7 of DefineSprite_23
 *   Each etoile:
 *   - Random position: _X = 140*(rand-0.5), _Y = 70*(rand-0.5)
 *   - Random start frame: random(15)+1 (1-indexed) -> 0-15 (0-indexed)
 *   - At frame 13 (0-indexed: 12): stops, starts floating upward with vy,
 *     then after tf frames plays again until frame 55 (0-indexed: 54) -> removeMovieClip
 *
 * Original AS timing:
 * - Frame 7 (0-indexed: 6): Spawn 58 etoiles (c=2 to c<60)
 * - Frame 13 (0-indexed: 12): Play sound 'many_507'
 * - Frame 247 (0-indexed: 246): removeMovieClip / stop (end of DefineSprite_23)
 *
 * Etoile internal timing:
 * - Frame 1 (0-indexed: 0): Set random X/Y, gotoAndPlay(random(15)+1)
 * - Frame 13 (0-indexed: 12): stop(), start floating, after tf frames play again
 * - Frame 55 (0-indexed: 54): removeMovieClip
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const ETOILES_MANIFEST: SpriteManifest = {
  width: 82.55,
  height: 95.7,
  offsetX: -44.7,
  offsetY: -57.15,
};

interface EtoileInstance {
  anim: FrameAnimatedSprite;
  container: Container;
  vy: number;
  t: number;
  tf: number;
  end: boolean;
  phase: 'floating' | 'playing' | 'done';
  pausedAtFrame: boolean;
}

export class Spell507 extends BaseSpell {
  readonly spellId = 507;

  private etoileInstances: EtoileInstance[] = [];
  private etoilesContainer!: Container;
  private mainFrame = 0;
  private mainFrameAccumulator = 0;
  private mainSpawned = false;
  private mainSoundPlayed = false;
  private etoileTextures: Texture[] = [];
  private initScale = 1;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext,
  ): void {
    this.etoilesContainer = new Container();
    this.etoilesContainer.position.set(init.targetX, init.targetY);
    this.container.addChild(this.etoilesContainer);

    this.etoileTextures = textures.getFrames('lib_etoiles');
    this.initScale = init.scale;
  }

  private spawnEtoiles(): void {
    const anchor = calculateAnchor(ETOILES_MANIFEST);

    // AS: c = 2; while(c < 60) -> indices 2..59, total 58 etoiles
    for (let c = 2; c < 60; c++) {
      // AS frame_1/DoAction: gotoAndPlay(random(15)+1) -> 1-indexed start
      // 0-indexed: startFrame = 0..14
      const startFrame = Math.floor(Math.random() * 15);

      // AS frame_1/DoAction: _X = 140*(rand-0.5), _Y = 70*(rand-0.5)
      const posX = 140 * (Math.random() - 0.5);
      const posY = 70 * (Math.random() - 0.5);

      const etoileContainer = new Container();
      etoileContainer.position.set(posX, posY);

      const anim = new FrameAnimatedSprite({
        textures: this.etoileTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: this.initScale,
        startFrame: startFrame,
      });

      etoileContainer.addChild(anim.sprite);
      this.etoilesContainer.addChild(etoileContainer);

      const instance: EtoileInstance = {
        anim,
        container: etoileContainer,
        vy: 0,
        t: 0,
        tf: 0,
        end: false,
        phase: 'floating',
        pausedAtFrame: false,
      };

      this.etoileInstances.push(instance);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Advance main timeline (DefineSprite_23)
    this.mainFrameAccumulator += deltaTime;
    const frameTime = 1000 / 60;
    while (this.mainFrameAccumulator >= frameTime) {
      this.mainFrameAccumulator -= frameTime;
      this.mainFrame++;

      // AS frame 7 (0-indexed: 6): spawn etoiles
      if (this.mainFrame === 6 && !this.mainSpawned) {
        this.mainSpawned = true;
        this.spawnEtoiles();
      }

      // AS frame 13 (0-indexed: 12): play sound + signal hit
      if (this.mainFrame === 12 && !this.mainSoundPlayed) {
        this.mainSoundPlayed = true;
        this.callbacks.playSound('many_507');
        this.signalHit();
      }

      // AS frame 247 (0-indexed: 246): end
      if (this.mainFrame >= 246) {
        this.complete();
        return;
      }
    }

    // Update all etoile instances
    const toRemove: EtoileInstance[] = [];

    for (const instance of this.etoileInstances) {
      const { anim } = instance;

      if (instance.phase === 'done') {
        continue;
      }

      // Update animation
      anim.update(deltaTime);

      // Check if we've reached frame 12 (0-indexed) = AS frame 13 for the first time
      if (!instance.pausedAtFrame && anim.getFrame() >= 12) {
        instance.pausedAtFrame = true;
        // AS frame 13: stop(), tf=30+random(90), vy=-3*Math.random(), t=0
        anim.pause();
        instance.tf = 30 + Math.floor(Math.random() * 90);
        instance.vy = -3 * Math.random();
        instance.t = 0;
        instance.end = false;
        instance.phase = 'floating';
      }

      // If in floating phase, apply onEnterFrame logic from AS frame 13 DoAction
      if (instance.pausedAtFrame && instance.phase === 'floating') {
        // AS: _Y = _Y + vy; vy *= 0.9;
        instance.container.position.y += instance.vy;
        instance.vy *= 0.9;

        // AS: if(t++ > tf & end != 1) { play(); end = 1; }
        if (instance.t > instance.tf && !instance.end) {
          anim.play();
          instance.end = true;
          instance.phase = 'playing';
        }
        instance.t++;
      }

      // If playing phase, check for frame 54 (0-indexed) = AS frame 55 -> removeMovieClip
      if (instance.phase === 'playing') {
        if (anim.getFrame() >= 54 || anim.isComplete()) {
          instance.phase = 'done';
          instance.container.visible = false;
          toRemove.push(instance);
        }
      }
    }

    // Remove done instances from tracking list
    for (const inst of toRemove) {
      const idx = this.etoileInstances.indexOf(inst);
      if (idx !== -1) {
        this.etoileInstances.splice(idx, 1);
      }
    }
  }

  destroy(): void {
    this.etoileInstances = [];
    super.destroy();
  }
}
