/**
 * Spell 2901 - Fireworks
 *
 * A fireworks spell that launches a rocket to the target, then explodes.
 *
 * Components:
 * - DefineSprite_31 (main timeline): The overall fireworks animation
 *   - Frame 1: Play sound 'fireworks01', set random scale (80-120%) and rotation (-20 to +20)
 *   - Frame 70: Play sound 'explo_fireworks' → signals hit
 *   - Frame 76: Attach 'feux' instances (5 + 7*((level-1)%3) fireworks)
 *   - Frame 97: stop()
 *
 * The main animation uses the 'feux' composite sprite which contains sub-animations
 * (minifeux, minifeux2, minifeux3, minifeux4) as particles.
 *
 * Since the sprite sheets are pre-rendered composites, we use the extracted
 * animation frames directly rather than simulating the complex nested particle system.
 *
 * Original AS timing (DefineSprite_31):
 * - Frame 1 (0-indexed: 0): Play 'fireworks01', set scale/rotation
 * - Frame 70 (0-indexed: 69): Play 'explo_fireworks' → signal hit
 * - Frame 97 (0-indexed: 96): stop()
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

// Manifests from manifest.json
const MINIFEUX4_MANIFEST: SpriteManifest = {
  width: 5.35,
  height: 6.6,
  offsetX: -1.25,
  offsetY: -2.85,
};

const MINIFEUX3_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX2_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const MINIFEUX_MANIFEST: SpriteManifest = {
  width: 2.45,
  height: 2.05,
  offsetX: 0.2,
  offsetY: -1.2,
};

const FEUX_MANIFEST: SpriteManifest = {
  width: 48.25,
  height: 53.3,
  offsetX: -18.65,
  offsetY: -26.75,
};

export class Spell2901 extends BaseSpell {
  readonly spellId = 2901;

  // Main outer container scaled and rotated per AS
  private mainContainer!: Container;

  // The feux container (appears at frame 76, scaled per level)
  private feuxContainer!: Container;

  // The feux explosion anims (attached at frame 76)
  private feuxAnims: FrameAnimatedSprite[] = [];

  // The pre-rendered composite animations
  private minifeux4Anim!: FrameAnimatedSprite;
  private minifeux3Anim!: FrameAnimatedSprite;
  private minifeux2Anim!: FrameAnimatedSprite;
  private minifeuxAnim!: FrameAnimatedSprite;
  private feuxAnim!: FrameAnimatedSprite;

  // Frame counter to know when to show feux
  private frameCount = 0;
  private readonly FRAME_TIME = 1000 / 60;
  private frameAccumulator = 0;
  private feuxSpawned = false;
  private stopped = false;
  private level = 1;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    this.level = Math.max(1, Math.min(6, context?.level ?? 1));

    // AS: taille = 80 + random(40); _xscale = taille; _yscale = taille;
    // AS: _rotation = -20 + random(40);
    const taille = 80 + Math.floor(Math.random() * 40);
    const rotation = -20 + Math.floor(Math.random() * 40);
    const mainScale = (taille / 100) * init.scale;

    // Main container at target position (the fireworks explode at target)
    this.mainContainer = new Container();
    this.mainContainer.position.set(init.targetX, init.targetY);
    this.mainContainer.scale.set(mainScale);
    this.mainContainer.rotation = (rotation * Math.PI) / 180;
    this.container.addChild(this.mainContainer);

    // --- Pre-rendered composite animations ---
    // These are the exported composite sprite sheets that show the full
    // nested animation as a flat sequence of frames.

    // feux (the main firework burst) - 16 frames
    const feuxAnchor = calculateAnchor(FEUX_MANIFEST);
    this.feuxAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("feux"),
        anchorX: feuxAnchor.x,
        anchorY: feuxAnchor.y,
        scale: 1,
      })
    );
    this.feuxAnim.sprite.visible = false;
    this.mainContainer.addChild(this.feuxAnim.sprite);

    // minifeux4 (78 frames)
    const mf4Anchor = calculateAnchor(MINIFEUX4_MANIFEST);
    this.minifeux4Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("minifeux4"),
        anchorX: mf4Anchor.x,
        anchorY: mf4Anchor.y,
        scale: 1,
      })
    );
    this.minifeux4Anim.sprite.visible = false;
    this.mainContainer.addChild(this.minifeux4Anim.sprite);

    // minifeux3 (78 frames)
    const mf3Anchor = calculateAnchor(MINIFEUX3_MANIFEST);
    this.minifeux3Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("minifeux3"),
        anchorX: mf3Anchor.x,
        anchorY: mf3Anchor.y,
        scale: 1,
      })
    );
    this.minifeux3Anim.sprite.visible = false;
    this.mainContainer.addChild(this.minifeux3Anim.sprite);

    // minifeux2 (36 frames)
    const mf2Anchor = calculateAnchor(MINIFEUX2_MANIFEST);
    this.minifeux2Anim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("minifeux2"),
        anchorX: mf2Anchor.x,
        anchorY: mf2Anchor.y,
        scale: 1,
      })
    );
    this.minifeux2Anim.sprite.visible = false;
    this.mainContainer.addChild(this.minifeux2Anim.sprite);

    // minifeux (36 frames)
    const mfAnchor = calculateAnchor(MINIFEUX_MANIFEST);
    this.minifeuxAnim = this.anims.add(
      new FrameAnimatedSprite({
        textures: textures.getFrames("minifeux"),
        anchorX: mfAnchor.x,
        anchorY: mfAnchor.y,
        scale: 1,
      })
    );
    this.minifeuxAnim.sprite.visible = false;
    this.mainContainer.addChild(this.minifeuxAnim.sprite);

    // Container for feux instances (shown at frame 76)
    // AS: sz = 60 + 20 * ((level - 1) % 3)
    const sz = 60 + 20 * ((this.level - 1) % 3);
    this.feuxContainer = new Container();
    this.feuxContainer.scale.set(sz / 100);
    this.feuxContainer.visible = false;
    this.mainContainer.addChild(this.feuxContainer);

    // Sound at frame 0 (AS frame 1)
    this.callbacks.playSound("fireworks01");
  }

  /**
   * Spawn feux instances at frame 75 (0-indexed) = AS frame 76
   * AS: i from 1 while i < 6 + 7*((level-1)%3)  → count = 5 + 7*((level-1)%3)
   */
  private spawnFeux(textures: SpellTextureProvider): void {
    if (this.feuxSpawned) {
      return;
    }

    this.feuxSpawned = true;
    this.feuxContainer.visible = true;

    const feuxAnchor = calculateAnchor(FEUX_MANIFEST);
    // AS: while(i < 6 + 7 * ((level-1)%3)) → i goes 1,2,...,5+7*... so count = 5 + 7*((level-1)%3)
    const count = 5 + 7 * ((this.level - 1) % 3);

    for (let i = 0; i < count; i++) {
      const anim = new FrameAnimatedSprite({
        textures: textures.getFrames("feux"),
        anchorX: feuxAnchor.x,
        anchorY: feuxAnchor.y,
        scale: 1,
      });

      // Place randomly around origin for the explosion
      anim.sprite.position.set(
        -20 + Math.floor(Math.random() * 40),
        -20 + Math.floor(Math.random() * 40)
      );
      anim.sprite.rotation = (Math.floor(Math.random() * 360) * Math.PI) / 180;

      this.feuxAnims.push(anim);
      this.feuxContainer.addChild(anim.sprite);
      this.anims.add(anim);
    }
  }

  // We need to track textures for deferred feux spawn
  private _textures?: SpellTextureProvider;

  protected override init(
    context: SpellContext,
    callbacks: import("@dofus/spell-runtime").SpellCallbacks,
    textures: SpellTextureProvider
  ): void {
    this._textures = textures;
    super.init(context, callbacks, textures);
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    if (this.stopped) {
      this.complete();
      return;
    }

    this.frameAccumulator += deltaTime;

    while (this.frameAccumulator >= this.FRAME_TIME) {
      this.frameAccumulator -= this.FRAME_TIME;
      this.frameCount++;

      // AS frame 70 (0-indexed: 69): play 'explo_fireworks' and signal hit
      if (this.frameCount === 69) {
        this.callbacks.playSound("explo_fireworks");
        this.signalHit();

        // Show the explosion visuals
        this.feuxAnim.sprite.visible = true;
        this.minifeux4Anim.sprite.visible = true;
        this.minifeux3Anim.sprite.visible = true;
        this.minifeux2Anim.sprite.visible = true;
        this.minifeuxAnim.sprite.visible = true;
      }

      // AS frame 76 (0-indexed: 75): attach feux instances
      if (this.frameCount === 75) {
        if (this._textures) {
          this.spawnFeux(this._textures);
        }
      }

      // AS frame 97 (0-indexed: 96): stop()
      if (this.frameCount >= 96) {
        this.stopped = true;
        break;
      }
    }

    this.anims.update(deltaTime);

    if (this.stopped) {
      this.complete();
    }
  }
}
