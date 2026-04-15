/**
 * Spell 2066 - Boo
 *
 * A spell with a rising "boo" effect at the caster and a beam/impact at the target
 * with bubble particles.
 *
 * Components:
 * - sprite_10 (DefineSprite_10): At caster position (cellFrom, y-25), plays sound "boo_up" on frame 1,
 *   contains sprite_9 which is rotated by angle, stops at frame 45
 * - sprite_11 (DefineSprite_11): At target position (cellTo, y-30), rotated by angle,
 *   spawns 6 bubble particles at frame 70, signals hit at frame 70, ends at frame 133
 * - sprite_4 (DefineSprite_4): Appears on main timeline, plays sound "jet_903" at frame 2,
 *   stops at frame 51
 *
 * Original AS timing:
 * - Frame 1 (sprite_10): Play sound 'boo_up', position at cellFrom x, cellFrom.y - 25
 * - Frame 1 (sprite_11): Position at cellTo, rotate by angle
 * - Frame 2 (main): Play sound 'jet_903', stop
 * - Frame 25 (sprite_9): stop()
 * - Frame 46 (sprite_10): stop()
 * - Frame 52 (sprite_4): stop()
 * - Frame 70 (sprite_11): Spawn 6 bubbles, signal hit (this.end())
 * - Frame 133 (sprite_11): removeMovieClip() - animation ends
 */

import type { SpellContext, SpellTextureProvider } from "@dofus/spell-runtime";
import {
  ASParticleSystem,
  BaseSpell,
  calculateAnchor,
  FrameAnimatedSprite,
  type SpellInitContext,
  type SpriteManifest,
} from "@dofus/spell-runtime";
import { Container } from "pixi.js";

const SPRITE_4_MANIFEST: SpriteManifest = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

const SPRITE_9_MANIFEST: SpriteManifest = {
  width: 215.5,
  height: 37.6,
  offsetX: -47.1,
  offsetY: -18.8,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 215.5,
  height: 72.45,
  offsetX: -48.1,
  offsetY: -60,
};

const SPRITE_11_MANIFEST: SpriteManifest = {
  width: 238.5,
  height: 50.05,
  offsetX: -236.15,
  offsetY: -24.9,
};

const _BULLE_MANIFEST: SpriteManifest = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

export class Spell2066 extends BaseSpell {
  readonly spellId = 2066;

  private sprite11Anim!: FrameAnimatedSprite;
  private bubbleParticles!: ASParticleSystem;
  private bubblesSpawned = false;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    // Main timeline: sprite_4 at caster position, sound "jet_903" at frame 2 (0-indexed: 1), stop at frame 52 (0-indexed: 51)
    const sprite4Anchor = calculateAnchor(SPRITE_4_MANIFEST);
    const sprite4Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_4"),
        anchorX: sprite4Anchor.x,
        anchorY: sprite4Anchor.y,
        scale: init.scale,
      })
    );
    sprite4Anim.sprite.position.set(0, init.casterY);
    sprite4Anim
      .stopAt(51)
      .onFrame(1, () => this.callbacks.playSound("jet_903"));
    this.container.addChild(sprite4Anim.sprite);

    // sprite_10 (DefineSprite_10): positioned at cellFrom.x, cellFrom.y - 25
    // In our coordinate system, container is at cellFrom, so x=0, y=-25
    // Contains sprite_9 which is rotated by angle
    // Plays sound "boo_up" at frame 1 (0-indexed: 0), stops at frame 46 (0-indexed: 45)
    const sprite10Container = new Container();
    sprite10Container.scale.set(init.scale);
    // AS: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 25;
    // Since our container is already at cellFrom, offset is (0, -25)
    sprite10Container.position.set(0, -25);
    this.container.addChild(sprite10Container);

    const sprite10Anchor = calculateAnchor(SPRITE_10_MANIFEST);
    const sprite10Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_10"),
        anchorX: sprite10Anchor.x,
        anchorY: sprite10Anchor.y,
        scale: 1,
      })
    );
    sprite10Anim.sprite.position.set(0, 0);
    sprite10Anim
      .stopAt(45)
      .onFrame(0, () => this.callbacks.playSound("boo_up"));
    sprite10Container.addChild(sprite10Anim.sprite);

    // sprite_9 inside sprite_10 (PlaceObject2_9_1): rotated by angle
    // AS: onClipEvent(load) { _rotation = _parent._parent.angle; }
    // sprite_9 stops at frame 25 (0-indexed: 24)
    const sprite9Anchor = calculateAnchor(SPRITE_9_MANIFEST);
    const sprite9Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_9"),
        anchorX: sprite9Anchor.x,
        anchorY: sprite9Anchor.y,
        scale: 1,
      })
    );
    sprite9Anim.sprite.rotation = init.angleRad;
    sprite9Anim.sprite.position.set(0, 0);
    sprite9Anim.stopAt(24);
    sprite10Container.addChild(sprite9Anim.sprite);

    // sprite_11 (DefineSprite_11): positioned at cellTo, y-30, rotated by angle
    // AS: _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 30; _rotation = _parent.angle;
    // In our coordinate system (relative to cellFrom):
    //   x = cellTo.x - cellFrom.x = init.targetX
    //   y = (cellTo.y - cellFrom.y) - 30
    //   But init.targetY = (cellTo.y - cellFrom.y) + Y_OFFSET where Y_OFFSET = -50
    //   So cellTo.y - cellFrom.y = init.targetY - Y_OFFSET = init.targetY + 50
    //   y = (init.targetY + 50) - 30 = init.targetY + 20
    const sprite11Anchor = calculateAnchor(SPRITE_11_MANIFEST);
    this.sprite11Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_11"),
        anchorX: sprite11Anchor.x,
        anchorY: sprite11Anchor.y,
        scale: init.scale,
      })
    );
    this.sprite11Anim.sprite.position.set(init.targetX, init.targetY + 20);
    this.sprite11Anim.sprite.rotation = init.angleRad;
    this.sprite11Anim.onFrame(69, () => this.onSprite11Frame70(textures, init));
    this.container.addChild(this.sprite11Anim.sprite);

    // Bubble particle system
    const bulleTextures = textures.getFrames("lib_bulle");
    const bulleTexture = bulleTextures[0];
    this.bubbleParticles = new ASParticleSystem(bulleTexture);
    this.bubbleParticles.container.position.set(
      init.targetX,
      init.targetY + 20
    );
    this.bubbleParticles.container.rotation = init.angleRad;
    this.bubbleParticles.container.scale.set(init.scale);
    this.container.addChild(this.bubbleParticles.container);
  }

  private onSprite11Frame70(
    textures: SpellTextureProvider,
    _init: SpellInitContext
  ): void {
    if (this.bubblesSpawned) {
      return;
    }
    this.bubblesSpawned = true;

    // Signal hit (AS: this.end())
    this.signalHit();

    // AS: c = 1; while(c < 7) { this.attachMovie("bulle","bulle" + c, c); c++; }
    // Spawns 6 bubbles (c=1,2,3,4,5,6)
    // Each bubble's onEnterFrame uses physics from DefineSprite_5_bulle/frame_1/DoAction.as:
    // rx = 0.7 + 0.15 * Math.random()
    // ry = 0.8 + 0.15 * Math.random()
    // vx = 20 + random(25)  -> 20 + Math.floor(Math.random() * 25)
    // vy = -15 + random(30) -> -15 + Math.floor(Math.random() * 30)
    // _alpha = random(50) + 50 -> Math.floor(Math.random() * 50) + 50
    // Each bubble's inner sprite (sprite_4) starts at random(10)+1 (0-indexed: Math.floor(Math.random()*10))

    // The bulle library symbol has width=28, height=30.65, offsetX=-16.6, offsetY=-14.85
    const bulleAnchor = calculateAnchor({
      width: 28,
      height: 30.65,
      offsetX: -16.6,
      offsetY: -14.85,
    });

    const bulleTexture = textures.getFrames("lib_bulle")[0];
    this.bubbleParticles.setTexture(bulleTexture);

    this.bubbleParticles.spawnMany(6, () => {
      const rx = 0.7 + 0.15 * Math.random();
      const ry = 0.8 + 0.15 * Math.random();
      const vx = 20 + Math.floor(Math.random() * 25);
      const vy = -15 + Math.floor(Math.random() * 30);
      const alpha = (Math.floor(Math.random() * 50) + 50) / 100;

      return {
        x: 0,
        y: 0,
        vx,
        vy,
        accX: rx,
        accY: ry,
        alpha,
        t: 100,
        vt: 0,
      };
    });

    // Adjust bubble sprites for anchor
    const sprites = this.bubbleParticles.container.children;
    for (const child of sprites) {
      if ("anchor" in child) {
        (
          child as { anchor: { set: (x: number, y: number) => void } }
        ).anchor.set(bulleAnchor.x, bulleAnchor.y);
      }
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);
    this.bubbleParticles.update();

    // Spell ends when sprite_11 completes (frame 133 = 0-indexed 132, which is last frame)
    if (this.sprite11Anim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    this.bubbleParticles.destroy();
    super.destroy();
  }
}
