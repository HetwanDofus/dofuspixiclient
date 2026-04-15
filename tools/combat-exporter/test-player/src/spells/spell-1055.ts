/**
 * Spell 1055 - Vlad (Sadida)
 *
 * Two sprite_8 animations play simultaneously: one at cellFrom, one at cellTo.
 * At frame 4 of each sprite_8, 10 "spire" particle instances are spawned
 * and a sound plays. Each spire rises upward and fades out.
 * sprite_9 plays at both positions, signaling hit at frame 10.
 *
 * Components:
 * - sprite_8 (at cellFrom): Plays sound at frame 4, spawns 10 spires, stops at frame 115
 * - sprite_8 (at cellTo): Spawns 10 spires, stops at frame 115
 * - sprite_9 (at cellFrom): Signals hit at frame 10, completes at frame 27
 * - sprite_9 (at cellTo): Signals hit at frame 10, completes at frame 27
 * - 20 total spire particles (10 per location), rising and fading
 *
 * Original AS timing:
 * - Main frame 2: stop() - two sprite_8 instances placed
 * - sprite_8 frame 4: playSound('vlad_804'), spawn 10 spires at _X, _Y - random(50)
 * - sprite_9 frame 10: this.end() (signal hit)
 * - sprite_8 frame 115: removeMovieClip()
 *
 * Spire physics (per enterFrame):
 * - _yscale *= 1.02
 * - _Y -= (v *= 0.97)
 * - _alpha -= va
 * - dies when _alpha < 0
 */

import { Sprite, Texture, Container } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_8_MANIFEST: SpriteManifest = {
  width: 51.8,
  height: 207.35,
  offsetX: -27.45,
  offsetY: -182.45,
};

const SPIRE_MANIFEST: SpriteManifest = {
  width: 12.65,
  height: 23.8,
  offsetX: -6.05,
  offsetY: -11.9,
};

interface SpireParticle {
  sprite: Sprite;
  x: number;
  y: number;
  xscale: number;
  yscale: number;
  /** AS _alpha value (0-100 range) */
  alpha: number;
  va: number;
  v: number;
  alive: boolean;
}

export class Spell1055 extends BaseSpell {
  readonly spellId = 1055;

  private spireTextures: Texture[] = [];
  private spireAnchorX = 0.5;
  private spireAnchorY = 0.5;
  private spireScale = 1;

  private spireContainer1!: Container;
  private spireContainer2!: Container;
  private spires1: SpireParticle[] = [];
  private spires2: SpireParticle[] = [];

  private sprite8_1!: FrameAnimatedSprite;
  private sprite8_2!: FrameAnimatedSprite;
  private sprite9_1!: FrameAnimatedSprite;
  private sprite9_2!: FrameAnimatedSprite;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.spireScale = init.scale;

    // Preload spire textures (sprite_2 has 2 frames used by spire library symbol)
    this.spireTextures = textures.getFrames('sprite_2');

    const spireAnchor = calculateAnchor(SPIRE_MANIFEST);
    this.spireAnchorX = spireAnchor.x;
    this.spireAnchorY = spireAnchor.y;

    const sprite8Textures = textures.getFrames('sprite_8');
    const sprite8Anchor = calculateAnchor(SPRITE_8_MANIFEST);
    const sprite9Textures = textures.getFrames('sprite_9');

    // Calculate positions
    // AS: instance 1 -> _X = _parent.cellFrom.x, _Y = _parent.cellFrom.y
    // Container is placed at cellFrom, so local coords: (0, 0)
    const pos1x = 0;
    const pos1y = 0;

    // AS: instance 2 -> _X = _parent.cellTo.x, _Y = _parent.cellTo.y
    // Relative to container (which is at cellFrom):
    const pos2x = (context?.cellTo && context?.cellFrom)
      ? context.cellTo.x - context.cellFrom.x
      : 0;
    const pos2y = (context?.cellTo && context?.cellFrom)
      ? context.cellTo.y - context.cellFrom.y
      : 0;

    // --- Spire containers ---
    this.spireContainer1 = new Container();
    this.spireContainer1.position.set(pos1x, pos1y);
    this.container.addChild(this.spireContainer1);

    this.spireContainer2 = new Container();
    this.spireContainer2.position.set(pos2x, pos2y);
    this.container.addChild(this.spireContainer2);

    // --- sprite_8 instance 1 at cellFrom ---
    this.sprite8_1 = this.anims.add(new FrameAnimatedSprite({
      textures: sprite8Textures,
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      scale: init.scale,
    }));
    this.sprite8_1.sprite.position.set(pos1x, pos1y);
    // AS frame 4 = index 3: play sound + spawn spires
    // AS frame 115 = index 114: removeMovieClip -> stop there
    this.sprite8_1
      .onFrame(3, () => {
        this.callbacks.playSound('vlad_804');
        this.spawnSpires(this.spires1, this.spireContainer1);
      })
      .stopAt(114);
    this.container.addChild(this.sprite8_1.sprite);

    // --- sprite_8 instance 2 at cellTo ---
    this.sprite8_2 = this.anims.add(new FrameAnimatedSprite({
      textures: sprite8Textures,
      anchorX: sprite8Anchor.x,
      anchorY: sprite8Anchor.y,
      scale: init.scale,
    }));
    this.sprite8_2.sprite.position.set(pos2x, pos2y);
    this.sprite8_2
      .onFrame(3, () => {
        this.spawnSpires(this.spires2, this.spireContainer2);
      })
      .stopAt(114);
    this.container.addChild(this.sprite8_2.sprite);

    // --- sprite_9 instance 1 at cellFrom ---
    this.sprite9_1 = this.anims.add(new FrameAnimatedSprite({
      textures: sprite9Textures,
      anchorX: 0.5,
      anchorY: 0.5,
      scale: init.scale,
    }));
    this.sprite9_1.sprite.position.set(pos1x, pos1y);
    // AS frame 10 = index 9: this.end() -> signal hit
    this.sprite9_1.onFrame(9, () => this.signalHit());
    this.container.addChild(this.sprite9_1.sprite);

    // --- sprite_9 instance 2 at cellTo ---
    this.sprite9_2 = this.anims.add(new FrameAnimatedSprite({
      textures: sprite9Textures,
      anchorX: 0.5,
      anchorY: 0.5,
      scale: init.scale,
    }));
    this.sprite9_2.sprite.position.set(pos2x, pos2y);
    this.sprite9_2.onFrame(9, () => this.signalHit());
    this.container.addChild(this.sprite9_2.sprite);
  }

  /**
   * Spawn 10 spire particles.
   *
   * AS onClipEvent(load) for spire container (PlaceObject2_7_4):
   *   c = 1; while(c <= 10) {
   *     attachMovie("spire", "spire"+c, c);
   *     spireN._x = _X;              <- world X of sprite_8 = 0 in local spireContainer space
   *     spireN._y = _Y - random(50); <- world Y - random offset
   *     spireN._rotation = _rotation; <- 0
   *     spireN.c = c;
   *   }
   *
   * AS onClipEvent(load) for each spire (DefineSprite_3_spire):
   *   va = 1 + random(2.5);   -> random(2) in AS = 0 or 1 -> result: 1 or 2
   *   _alpha = 50 + random(50);
   *   _yscale = 80;
   *   _xscale = 80 + random(80);
   *   v = 0.67 + 1.67 * Math.random();
   *   if(c % 2 == 0) gotoAndStop(2) else gotoAndStop(1)
   *     -> frame index 1 or 0
   */
  private spawnSpires(particles: SpireParticle[], container: Container): void {
    for (let c = 1; c <= 10; c++) {
      // AS: _x = _X (world x of sprite_8 = 0 local to spireContainer)
      const x = 0;
      // AS: _y = _Y - random(50)
      const y = -(Math.floor(Math.random() * 50));

      // AS: va = 1 + random(2.5) -> random() arg truncated to int 2, so 0 or 1
      const va = 1 + Math.floor(Math.random() * 2);

      // AS: _alpha = 50 + random(50)  (stored as 0-100)
      const alpha = 50 + Math.floor(Math.random() * 50);

      // AS: _yscale = 80
      const yscale = 80;

      // AS: _xscale = 80 + random(80)
      const xscale = 80 + Math.floor(Math.random() * 80);

      // AS: v = 0.67 + 1.67 * Math.random()
      const v = 0.67 + 1.67 * Math.random();

      // AS: if(c % 2 == 0) gotoAndStop(2) else gotoAndStop(1)
      // gotoAndStop(2) -> frame index 1; gotoAndStop(1) -> frame index 0
      const frameIndex = (c % 2 === 0) ? 1 : 0;

      const texture = this.spireTextures[frameIndex] ?? (this.spireTextures[0] ?? Texture.EMPTY);
      const spr = new Sprite(texture);
      spr.anchor.set(this.spireAnchorX, this.spireAnchorY);
      spr.position.set(x, y);
      spr.scale.set((xscale / 100) * this.spireScale, (yscale / 100) * this.spireScale);
      spr.alpha = alpha / 100;

      container.addChild(spr);

      particles.push({
        sprite: spr,
        x,
        y,
        xscale,
        yscale,
        alpha,
        va,
        v,
        alive: true,
      });
    }
  }

  /**
   * Update spire particles - runs every frame tick.
   *
   * AS onClipEvent(enterFrame):
   *   _yscale = _yscale * 1.02;
   *   _Y = _Y - (v *= 0.97);
   *   _alpha = _alpha - va;
   *   if(_alpha < 0) { _parent.removeMovieClip(); }
   */
  private updateSpires(particles: SpireParticle[]): void {
    for (const p of particles) {
      if (!p.alive) {
        continue;
      }

      // AS: _yscale = _yscale * 1.02
      p.yscale = p.yscale * 1.02;

      // AS: _Y = _Y - (v *= 0.97)
      p.v *= 0.97;
      p.y = p.y - p.v;

      // AS: _alpha = _alpha - va
      p.alpha = p.alpha - p.va;

      // AS: if(_alpha < 0) removeMovieClip()
      if (p.alpha < 0) {
        p.alive = false;
        p.sprite.visible = false;
        continue;
      }

      p.sprite.position.set(p.x, p.y);
      p.sprite.scale.set(
        (p.xscale / 100) * this.spireScale,
        (p.yscale / 100) * this.spireScale,
      );
      p.sprite.alpha = p.alpha / 100;
    }
  }

  private spiresAllDead(particles: SpireParticle[]): boolean {
    if (particles.length === 0) {
      return true;
    }
    return particles.every(p => !p.alive);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.updateSpires(this.spires1);
    this.updateSpires(this.spires2);

    const sprite9Done = this.sprite9_1.isComplete() && this.sprite9_2.isComplete();
    const sprite8Done = this.sprite8_1.isStopped() && this.sprite8_2.isStopped();
    const spiresDone = this.spiresAllDead(this.spires1) && this.spiresAllDead(this.spires2);

    if (sprite9Done && sprite8Done && spiresDone) {
      this.complete();
    }
  }

  destroy(): void {
    for (const p of this.spires1) {
      p.sprite.destroy();
    }
    for (const p of this.spires2) {
      p.sprite.destroy();
    }
    this.spires1 = [];
    this.spires2 = [];
    super.destroy();
  }
}
