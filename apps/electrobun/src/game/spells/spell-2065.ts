/**
 * Spell 2065 - Boo (Osamodas)
 *
 * A spell with a beam effect at the caster and an impact effect at the target,
 * with bubble particles spawned at hit time.
 *
 * Components:
 * - sprite_9: Sub-sprite inside sprite_10 (beam), rotated by angle, stops at frame 24
 * - sprite_10 (DefineSprite_10): Beam at caster position (cellFrom.x, cellFrom.y - 25), stops at frame 45
 * - sprite_11 (DefineSprite_11): Impact at target position (cellTo.x, cellTo.y - 30), rotated by angle
 *   - At frame 70: spawns 6 bubble particles, signals hit (this.end())
 *   - At frame 133: removeMovieClip() - animation ends
 * - sprite_4: Used inside bulle library symbol, stops at frame 51
 * - bulle particles (sprite_5): 6 instances spawned at frame 70 of sprite_11
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'jet_903', stop()
 * - Frame 1 (sprite_10): Play sound 'boo_up', position at cellFrom.x, cellFrom.y-25
 * - Frame 1 (sprite_11): Position at cellTo.x, cellTo.y-30, rotate by angle
 * - Frame 25 (sprite_9): stop() -> index 24
 * - Frame 46 (sprite_10): stop() -> index 45
 * - Frame 52 (sprite_4): stop() -> index 51
 * - Frame 70 (sprite_11): spawn 6 bubbles, signal hit -> index 69
 * - Frame 133 (sprite_11): removeMovieClip() -> index 132
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

const SPRITE_4_MANIFEST: SpriteManifest = {
  width: 19.5,
  height: 21.35,
  offsetX: -11.55,
  offsetY: -10.35,
};

const BULLE_MANIFEST: SpriteManifest = {
  width: 28,
  height: 30.65,
  offsetX: -16.6,
  offsetY: -14.85,
};

interface BubbleParticle {
  anim: FrameAnimatedSprite;
  rx: number;
  ry: number;
  vx: number;
  vy: number;
  x: number;
  y: number;
  hasPhysics: boolean;
}

export class Spell2065 extends BaseSpell {
  readonly spellId = 2065;

  private impactAnim!: FrameAnimatedSprite;
  private bubbles: BubbleParticle[] = [];
  private bubblesContainer!: Container;
  private bubblesSpawned = false;
  private bulleTextures: Texture[] = [];
  private sprite4Textures: Texture[] = [];
  private cachedInit!: SpellInitContext;

  protected setup(
    _context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.cachedInit = init;

    // Play sound at main timeline frame 1
    this.callbacks.playSound("jet_903");

    // ---- sprite_10: Beam at caster position ----
    // DefineSprite_10 frame_1: _X = cellFrom.x; _Y = cellFrom.y - 25
    // Container is at cellFrom, so offset is (0, -25)
    const beamAnchor10 = calculateAnchor(SPRITE_10_MANIFEST);
    const beamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_10"),
        anchorX: beamAnchor10.x,
        anchorY: beamAnchor10.y,
        scale: init.scale,
      })
    );
    beamAnim.sprite.position.set(0, -25);
    beamAnim.stopAt(45).onFrame(0, () => this.callbacks.playSound("boo_up"));
    this.container.addChild(beamAnim.sprite);

    // ---- sprite_9: Sub-beam inside sprite_10, rotated by angle ----
    // PlaceObject2_9_1 onClipEvent(load): _rotation = _parent._parent.angle
    const beamAnchor9 = calculateAnchor(SPRITE_9_MANIFEST);
    const subBeamAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_9"),
        anchorX: beamAnchor9.x,
        anchorY: beamAnchor9.y,
        scale: init.scale,
      })
    );
    subBeamAnim.sprite.position.set(0, -25);
    subBeamAnim.sprite.rotation = init.angleRad;
    subBeamAnim.stopAt(24);
    this.container.addChild(subBeamAnim.sprite);

    // ---- sprite_11: Impact at target position ----
    // DefineSprite_11 frame_1: _X = cellTo.x; _Y = cellTo.y - 30; _rotation = angle
    // init.targetY = (cellTo.y - cellFrom.y) + Y_OFFSET = (cellTo.y - cellFrom.y) - 50
    // We need (cellTo.y - cellFrom.y) - 30 = init.targetY + 20
    const impactAnchor = calculateAnchor(SPRITE_11_MANIFEST);
    this.impactAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("sprite_11"),
        anchorX: impactAnchor.x,
        anchorY: impactAnchor.y,
        scale: init.scale,
      })
    );
    this.impactAnim.sprite.position.set(init.targetX, init.targetY + 20);
    this.impactAnim.sprite.rotation = init.angleRad;
    this.impactAnim
      .onFrame(69, () => this.spawnBubbles())
      .onFrame(132, () => this.complete());
    this.container.addChild(this.impactAnim.sprite);

    // Container for bubbles, positioned at target (same as impact)
    this.bubblesContainer = new Container();
    this.bubblesContainer.position.set(init.targetX, init.targetY + 20);
    this.container.addChild(this.bubblesContainer);

    // Cache textures for bubble spawning
    this.bulleTextures = textures.getFrames("lib_bulle");
    this.sprite4Textures = textures.getFrames("sprite_4");
  }

  private spawnBubbles(): void {
    if (this.bubblesSpawned) {
      return;
    }
    this.bubblesSpawned = true;

    // DefineSprite_11 frame_70 DoAction_2: this.end() -> signal hit
    this.signalHit();

    const bulleAnchor = calculateAnchor(BULLE_MANIFEST);
    const sprite4Anchor = calculateAnchor(SPRITE_4_MANIFEST);
    const init = this.cachedInit;

    // AS: c = 1; while(c < 7) -> spawns 6 bubbles (c = 1..6)
    for (let c = 1; c < 7; c++) {
      // DefineSprite_5_bulle frame_1 PlaceObject2_4_1 onClipEvent(load):
      // gotoAndPlay(random(10) + 1) -> startFrame = Math.floor(Math.random() * 10) (0-indexed)
      const innerStartFrame = Math.floor(Math.random() * 10);

      // Inner sprite_4 animation (stops at frame 52, index 51)
      const innerAnim = new FrameAnimatedSprite({
        textures: this.sprite4Textures,
        anchorX: sprite4Anchor.x,
        anchorY: sprite4Anchor.y,
        scale: init.scale,
        startFrame: innerStartFrame,
      });
      innerAnim.stopAt(51);

      // Bulle outer animation uses lib_bulle texture
      const bulleTextures =
        this.bulleTextures.length > 0
          ? this.bulleTextures
          : this.sprite4Textures;

      const bulleStartFrame = Math.floor(Math.random() * 10);
      const bulleAnim = new FrameAnimatedSprite({
        textures: bulleTextures,
        anchorX: bulleAnchor.x,
        anchorY: bulleAnchor.y,
        scale: init.scale,
        startFrame: bulleStartFrame,
      });

      // DefineSprite_5_bulle frame_1 DoAction:
      // rx = 0.7 + 0.15 * Math.random()
      // ry = 0.8 + 0.15 * Math.random()
      // vx = 20 + random(25)  -> Math.floor(Math.random() * 25)
      // vy = -15 + random(30) -> Math.floor(Math.random() * 30)
      // _alpha = random(50) + 50 -> Math.floor(Math.random() * 50) + 50
      const rx = 0.7 + 0.15 * Math.random();
      const ry = 0.8 + 0.15 * Math.random();
      const vx = 20 + Math.floor(Math.random() * 25);
      const vy = -15 + Math.floor(Math.random() * 30);
      const alphaPct = Math.floor(Math.random() * 50) + 50;

      bulleAnim.sprite.alpha = alphaPct / 100;
      bulleAnim.sprite.position.set(0, 0);
      innerAnim.sprite.position.set(0, 0);

      this.bubblesContainer.addChild(bulleAnim.sprite);
      this.bubblesContainer.addChild(innerAnim.sprite);

      // Bubble with physics
      this.bubbles.push({
        anim: bulleAnim,
        rx,
        ry,
        vx,
        vy,
        x: 0,
        y: 0,
        hasPhysics: true,
      });

      // Inner animation follows bubble position (no independent physics)
      this.bubbles.push({
        anim: innerAnim,
        rx: 0,
        ry: 0,
        vx: 0,
        vy: 0,
        x: 0,
        y: 0,
        hasPhysics: false,
      });
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update bubble physics: onEnterFrame: _X += (vx *= rx); _Y += (vy *= ry)
    for (const bubble of this.bubbles) {
      if (bubble.hasPhysics) {
        bubble.vx *= bubble.rx;
        bubble.vy *= bubble.ry;
        bubble.x += bubble.vx;
        bubble.y += bubble.vy;
        bubble.anim.sprite.position.set(bubble.x, bubble.y);
      }
      bubble.anim.update(deltaTime);
    }
  }

  destroy(): void {
    for (const bubble of this.bubbles) {
      bubble.anim.destroy();
    }
    this.bubbles = [];
    this.bubblesContainer.destroy({ children: false });
    super.destroy();
  }
}
