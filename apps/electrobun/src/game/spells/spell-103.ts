/**
 * Spell 103 - Ronce (Sadida)
 *
 * A thorn/vine spell that shoots a projectile from caster to target,
 * then spawns an impact effect.
 *
 * Components:
 * - shoot (DefineSprite_9_shoot): Projectile animation at caster position,
 *   contains baton2 instances (oscillating thorns), plays 106 frames then removes
 * - move (DefineSprite_10_move): At caster, spawns baton instances then triggers
 *   impact effet at frame 2
 * - effet (DefineSprite_14_effet): Impact effect at target, plays 18 frames
 *   (frame 16 = removeMovieClip)
 *
 * Original AS timing:
 * - Frame 1 (main): Play sound 'ronce'
 * - Frame 1 (shoot): Attach baton2 instances (count = 2 + level*level*0.7)
 * - Frame 1 (move): Attach baton instances (count = 2 + level*level*0.7)
 * - Frame 2 (move): Attach effet, stop
 * - Frame 16 (effet): removeMovieClip (ends)
 * - Frame 106 (shoot): removeMovieClip (ends)
 *
 * Hit signal: when effet starts playing (attached at move frame 2)
 * Complete: when both shoot and effet animations are done
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

const BATON2_MANIFEST: SpriteManifest = {
  width: 6.75,
  height: 35.15,
  offsetX: -3.2,
  offsetY: -19.1,
};

const EFFET_MANIFEST: SpriteManifest = {
  width: 100.8,
  height: 100.85,
  offsetX: -49.35,
  offsetY: -50.45,
};

interface Baton2State {
  sprite: FrameAnimatedSprite;
  a: number;
  i: number;
  v2: number;
}

interface BatonState {
  sprite: FrameAnimatedSprite;
  v: number;
  vy: number;
}

export class Spell103 extends BaseSpell {
  readonly spellId = 103;

  private shootAnim!: FrameAnimatedSprite;
  private effetAnim: FrameAnimatedSprite | null = null;
  private baton2States: Baton2State[] = [];
  private batonStates: BatonState[] = [];
  private shootContainer!: Container;
  private moveContainer!: Container;
  private effetContainer!: Container;
  private effetStarted = false;
  private level = 1;
  private moveAnim!: FrameAnimatedSprite;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));
    this.initScale = init.scale;
    this.initTargetX = init.targetX;
    this.initTargetY = init.targetY;

    // ── shoot container at caster position ──────────────────────────────────
    this.shootContainer = new Container();
    this.shootContainer.position.set(0, init.casterY);
    this.shootContainer.scale.set(init.scale);
    this.container.addChild(this.shootContainer);

    // shoot sprite (108 frames, removeMovieClip at frame 106 → index 105)
    this.shootAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("shoot"),
        fps: 60,
        anchorX: 0.5,
        anchorY: 0.5,
      })
    );
    this.shootAnim.stopAt(105);
    this.shootAnim.onFrame(0, () => this.callbacks.playSound("ronce"));
    this.shootContainer.addChild(this.shootAnim.sprite);

    // baton2 instances inside shoot (DefineSprite_9_shoot/frame_1/DoAction.as)
    // count = 2 + f * f * 0.7 where f = level
    const baton2Count = Math.floor(2 + this.level * this.level * 0.7);
    const baton2Textures = textures.getFrames("lib_baton2");
    const baton2Anchor = calculateAnchor(BATON2_MANIFEST);

    for (let c = 0; c < baton2Count; c++) {
      const baton2Anim = new FrameAnimatedSprite({
        textures: baton2Textures,
        fps: 60,
        anchorX: baton2Anchor.x,
        anchorY: baton2Anchor.y,
        loop: true,
      });

      // DefineSprite_7_baton2/frame_1/DoAction.as
      // t = 100 - random(50)
      const t = 100 - Math.floor(Math.random() * 50);
      baton2Anim.sprite.scale.set(t / 100, t / 100);
      // _X = 40 * (0.5 - Math.random())
      baton2Anim.sprite.x = 40 * (0.5 - Math.random());
      // _Y = 20 * (0.5 - Math.random())
      baton2Anim.sprite.y = 20 * (0.5 - Math.random());

      // DefineSprite_7_baton2/frame_1/PlaceObject2 onClipEvent(load)
      // a = 10 + random(20)
      const a = 10 + Math.floor(Math.random() * 20);
      // i = 6 * Math.random()
      const i = 6 * Math.random();
      // v2 = 1.05 + 0.5 * Math.random()
      const v2 = 1.05 + 0.5 * Math.random();

      this.baton2States.push({ sprite: baton2Anim, a, i, v2 });
      this.shootContainer.addChild(baton2Anim.sprite);
    }

    // ── move container at caster position ───────────────────────────────────
    this.moveContainer = new Container();
    this.moveContainer.position.set(0, init.casterY);
    this.moveContainer.scale.set(init.scale);
    this.container.addChild(this.moveContainer);

    // move sprite (2 frames)
    this.moveAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("move"),
        fps: 60,
        anchorX: 0.5,
        anchorY: 0.5,
      })
    );
    // frame 2 (index 1): attach effet, stop
    this.moveAnim.onFrame(1, () => this.spawnEffet(textures));
    this.moveAnim.stopAt(1);
    this.moveContainer.addChild(this.moveAnim.sprite);

    // baton instances inside move (DefineSprite_10_move/frame_1/DoAction.as)
    // count = 2 + f * f * 0.7
    const batonCount = Math.floor(2 + this.level * this.level * 0.7);
    const batonTextures = textures.getFrames("lib_baton");

    for (let c = 0; c < batonCount; c++) {
      const batonAnim = new FrameAnimatedSprite({
        textures: batonTextures,
        fps: 60,
        anchorX: 0.5,
        anchorY: 0.5,
        loop: true,
      });

      // DefineSprite_8_baton/frame_1/DoAction.as
      // v = 1.6 * (-0.5 + Math.random())
      const v = 1.6 * (-0.5 + Math.random());
      // vy = 3 * (-0.5 + Math.random())
      const vy = 3 * (-0.5 + Math.random());
      // t = 50 + 40 * (-0.5 + Math.random())
      const t = 50 + 40 * (-0.5 + Math.random());
      batonAnim.sprite.scale.set((t + 5) / 100, (t + 5) / 100);

      this.batonStates.push({ sprite: batonAnim, v, vy });
      this.moveContainer.addChild(batonAnim.sprite);
    }

    // ── effet container at target position ──────────────────────────────────
    this.effetContainer = new Container();
    this.effetContainer.position.set(init.targetX, init.targetY);
    this.effetContainer.scale.set(init.scale);
    this.container.addChild(this.effetContainer);
  }

  private spawnEffet(textures: SpellTextureProvider): void {
    if (this.effetStarted) {
      return;
    }
    this.effetStarted = true;

    // Signal hit when effet appears
    this.signalHit();

    const effetAnchor = calculateAnchor(EFFET_MANIFEST);
    this.effetAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("lib_effet"),
        fps: 60,
        anchorX: effetAnchor.x,
        anchorY: effetAnchor.y,
      })
    );

    // frame 16 (index 15): removeMovieClip → stop at frame 15
    this.effetAnim.stopAt(15);
    this.effetContainer.addChild(this.effetAnim.sprite);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    // Update baton2 oscillation physics (onClipEvent enterFrame)
    for (const state of this.baton2States) {
      // _rotation = a * Math.sin(i++)
      const rotDeg = state.a * Math.sin(state.i);
      state.i += 1;
      state.sprite.sprite.rotation = (rotDeg * Math.PI) / 180;
      // a /= v2
      state.a /= state.v2;
    }

    // Update baton drift physics (onEnterFrame)
    for (const state of this.batonStates) {
      // _X = _X + v
      state.sprite.sprite.x += state.v;
      // _Y = _Y + vy
      state.sprite.sprite.y += state.vy;
      // v *= 0.95
      state.v *= 0.95;
      // vy *= 0.95
      state.vy *= 0.95;
    }

    // Check completion: shoot done AND (effet done or not yet started but move done)
    const shootDone = this.shootAnim.isStopped() || this.shootAnim.isComplete();
    const effetDone =
      this.effetAnim !== null
        ? this.effetAnim.isStopped() || this.effetAnim.isComplete()
        : this.moveAnim.isStopped() || this.moveAnim.isComplete();

    if (shootDone && effetDone) {
      this.complete();
    }
  }
}
