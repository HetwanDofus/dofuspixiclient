/**
 * Spell 1050 - Sacrieur Blood Drop
 *
 * A blood drop effect that spawns 19 particles (gouttes) at the caster position,
 * each with randomized physics. The main animation plays at the target position.
 *
 * Components:
 * - sprite_7: Main impact animation at caster position, 78 frames
 * - sprite_4 (goutte): 19 particle instances spawned at frame 1, each with
 *   randomized alpha, scale, and physics
 *
 * Original AS timing:
 * - Frame 1 (sprite_7): Play sound 'sacrieur_1050', spawn 19 gouttes
 * - Frame 43 (sprite_7): Signal hit (this.end())
 * - Frame 49 (sprite_7): Play sound 'sacrieur_1050b'
 * - Frame 76 (sprite_7): removeMovieClip() + stop()
 *
 * Goutte physics (DefineSprite_5_goutte/PlaceObject2_4_1):
 * - On load: _Y = -1, g = 0.67, f = -11 - 1.67 * Math.random()
 * - On enterFrame: if _Y < 0: f += g; _Y += f; else if fin != 1: play(), fin=1, vx=0, vy=0
 *
 * Goutte container (DefineSprite_5_goutte/DoAction):
 * - vx = 7.5 * (-0.5 + Math.random())
 * - vy = 3.75 * (-0.5 + Math.random())
 * - onEnterFrame: _X += vx; _Y += vy
 *
 * Goutte sprite (sprite_4 / DefineSprite_4/frame_1):
 * - _alpha = 50 + random(50)
 * - t = 50 + random(60); _xscale = t; _yscale = t
 * - Stops at frame 28 (0-indexed: 27)
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const MAIN_MANIFEST: SpriteManifest = {
  width: 125.7,
  height: 96.75,
  offsetX: -62.1,
  offsetY: -64.8,
};

const GOUTTE_SPRITE_MANIFEST: SpriteManifest = {
  width: 20.4,
  height: 17.4,
  offsetX: -10.2,
  offsetY: -12.3,
};

interface GoutteParticle {
  /** Outer container that moves with vx/vy */
  container: Container;
  /** Inner sprite that has the drop animation */
  anim: FrameAnimatedSprite;
  /** Container-level velocity X */
  vx: number;
  /** Container-level velocity Y */
  vy: number;
  /** Inner sprite Y offset (starts at -1, falls with gravity) */
  innerY: number;
  /** Gravity constant */
  g: number;
  /** Vertical fall velocity (starts negative = upward) */
  f: number;
  /** Whether the drop has landed (fin flag) */
  fin: boolean;
  /** Whether particle is still alive */
  alive: boolean;
}

export class Spell1050 extends BaseSpell {
  readonly spellId = 1050;

  private mainAnim!: FrameAnimatedSprite;
  private gouttes: GoutteParticle[] = [];
  private goutteContainer!: Container;
  private spawnScale = 1;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.spawnScale = init.scale;

    // Main animation (sprite_7) at caster position
    // AS: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y;
    // We position at caster (origin = 0, casterY)
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_7'),
      ...calculateAnchor(MAIN_MANIFEST),
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(0, init.casterY);

    // Frame 1 (0-indexed: 0): play sound (already handled by sounds manifest at frame 0)
    this.mainAnim.onFrame(0, () => this.callbacks.playSound('sacrieur_1050'));

    // Frame 43 (0-indexed: 42): signal hit
    this.mainAnim.onFrame(42, () => this.signalHit());

    // Frame 49 (0-indexed: 48): play second sound
    this.mainAnim.onFrame(48, () => this.callbacks.playSound('sacrieur_1050b'));

    // Frame 76 (0-indexed: 75): stop
    this.mainAnim.stopAt(75);

    this.container.addChild(this.mainAnim.sprite);

    // Goutte container - positioned at caster
    this.goutteContainer = new Container();
    this.goutteContainer.position.set(0, init.casterY);
    this.container.addChild(this.goutteContainer);

    // Spawn gouttes on frame 1 (immediately, since we process frame 0 callbacks)
    this.mainAnim.onFrame(0, () => this.spawnGouttes(textures));
  }

  private spawnGouttes(textures: SpellTextureProvider): void {
    const gouteTextures = textures.getFrames('sprite_4');
    const libTexture = textures.getFrames('lib_goutte')[0] ?? Texture.EMPTY;
    const anchor = calculateAnchor(GOUTTE_SPRITE_MANIFEST);

    // AS: c = 1; while(c < 20) -> spawns instances goutte1 through goutte19 (19 total)
    for (let c = 1; c < 20; c++) {
      // Outer container (DefineSprite_5_goutte) with vx/vy
      // AS DoAction in DefineSprite_5_goutte frame_1:
      // vx = 7.5 * (-0.5 + Math.random())
      // vy = 3.75 * (-0.5 + Math.random())
      const vx = 7.5 * (-0.5 + Math.random());
      const vy = 3.75 * (-0.5 + Math.random());

      const outerContainer = new Container();
      // Initial position: gouttes are at the caster position (origin of goutteContainer)
      outerContainer.position.set(0, 0);

      // Inner sprite (sprite_4 / DefineSprite_4):
      // AS: _alpha = 50 + random(50)
      // AS: t = 50 + random(60); _xscale = t; _yscale = t
      const alpha = (50 + Math.floor(Math.random() * 50)) / 100;
      const t = 50 + Math.floor(Math.random() * 60);
      const spriteScale = (t / 100) * this.spawnScale;

      const anim = new FrameAnimatedSprite({
        textures: gouteTextures.length > 0 ? gouteTextures : [libTexture],
        anchorX: anchor.x,
        anchorY: anchor.y,
        scale: spriteScale,
      });
      anim.sprite.alpha = alpha;
      // sprite_4 stops at frame 28 (0-indexed: 27)
      anim.stopAt(27);

      outerContainer.addChild(anim.sprite);
      this.goutteContainer.addChild(outerContainer);

      // Physics for the inner drop position
      // AS onClipEvent(load): _Y = -1; g = 0.67; f = -11 - 1.67 * Math.random()
      const particle: GoutteParticle = {
        container: outerContainer,
        anim,
        vx,
        vy,
        innerY: -1,
        g: 0.67,
        f: -11 - 1.67 * Math.random(),
        fin: false,
        alive: true,
      };

      this.gouttes.push(particle);
    }
  }

  private updateGouttes(): void {
    for (const p of this.gouttes) {
      if (!p.alive) {
        continue;
      }

      // Outer container movement (onEnterFrame on the DefineSprite_5_goutte):
      // _X += vx; _Y += vy (but vx/vy get zeroed when fin=1)
      p.container.x += p.vx;
      p.container.y += p.vy;

      // Inner sprite_5 (PlaceObject2_4_1) physics:
      // if (_Y < 0) { f += g; _Y = _Y + f; }
      // else if (fin != 1) { play(); fin = 1; _parent.vx = 0; _parent.vy = 0; }
      if (p.innerY < 0) {
        p.f += p.g;
        p.innerY += p.f;
        p.anim.sprite.y = p.innerY;
      } else if (!p.fin) {
        p.anim.play();
        p.fin = true;
        p.vx = 0;
        p.vy = 0;
      }

      // Update the animation
      // Only update if playing (fin=true or still falling but anim stopped by default)
      p.anim.update(1000 / 60);

      if (p.anim.isComplete() || p.anim.isStopped()) {
        // Once animation is stopped/complete, mark as done eventually
        // We keep it alive until main anim ends
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updateGouttes();

    if (this.mainAnim.isStopped() || this.mainAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    for (const p of this.gouttes) {
      p.anim.destroy();
      p.container.destroy({ children: true });
    }

    this.gouttes = [];

    super.destroy();
  }
}
