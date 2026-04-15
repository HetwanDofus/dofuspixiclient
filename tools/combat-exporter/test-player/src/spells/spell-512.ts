/**
 * Spell 512 - (Eniripsa/Sacrieur stone spell)
 *
 * An impact spell with falling stones (pierres) particle effect.
 *
 * Components:
 * - sprite_27: Looping background/ground animation at target, random start frame
 * - sprite_28: (embedded within sprite_42 composite) - handled by sprite_42 frames
 * - sprite_42: Main impact animation at target position, 213 frames
 *   - sprite_10: Wobbling rock sprite placed at frame 7, shakes randomly
 *   - pierres particles: 7 stones spawned at frame 61, physics simulation
 *
 * Original AS timing:
 * - Frame 1 (sprite_42): Play sound 'licrounch_1008', position at cellTo
 * - Frame 7 (sprite_42): Place wobbling sprite_10 (shakes X/Y randomly each frame)
 * - Frame 55 (sprite_42): Play sound 'many_512b'
 * - Frame 61 (sprite_42): this.end() -> signal hit; spawn 7 'pierres' particles
 * - Frame 211 (sprite_42): removeMovieClip() -> animation complete
 *
 * Pierres particle physics (onClipEvent load):
 *   vx = 5 * (Math.random() - 0.5)
 *   vy = 2 * (Math.random() - 0.5)
 *   parent._x = 20 * (Math.random() - 0.5)
 *   parent._y = 10 * (Math.random() - 0.5)
 *   t = 60 + 40 * Math.random()
 *   _alpha = 20 + random(90)
 *   v = -5 * Math.random() - 5
 *   vr = 40 * (-0.5 + Math.random())
 *
 * Pierres particle physics (onClipEvent enterFrame):
 *   parent._x += vx; parent._y += vy
 *   if (t != 1): _Y += v; _rotation += vr; v += 0.5
 *   if (_Y > 0): bounce with friction, eventually settle
 */

import { Container, Sprite, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const SPRITE_27_MANIFEST: SpriteManifest = {
  width: 64.75,
  height: 46.25,
  offsetX: -29.8,
  offsetY: -43.6,
};

const SPRITE_42_MANIFEST: SpriteManifest = {
  width: 120.6,
  height: 163.35,
  offsetX: -60.4,
  offsetY: -142.55,
};

const SPRITE_10_MANIFEST: SpriteManifest = {
  width: 33,
  height: 44,
  offsetX: -4.55,
  offsetY: -22.5,
};

const PIERRES_MANIFEST: SpriteManifest = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

interface PierreParticle {
  /** Outer container, moves in world XY */
  outerContainer: Container;
  /** Inner sprite, moves in local Y (vertical arc) and rotates */
  innerSprite: Sprite;
  vx: number;
  vy: number;
  /** Local Y velocity (vertical arc) */
  v: number;
  /** Local Y position */
  localY: number;
  /** Rotation in degrees */
  rotation: number;
  vr: number;
  /** t == 1 means settled/dead */
  t: number;
  alpha: number;
}

export class Spell512 extends BaseSpell {
  readonly spellId = 512;

  private mainAnim!: FrameAnimatedSprite;
  private bgAnim!: FrameAnimatedSprite;

  // The wobbling sprite_10 placed at frame 7 of sprite_42
  private wobbleSprite: Sprite | null = null;
  private wobbleTextures: Texture[] = [];
  private wobbleBaseY = 0;
  private wobbleI = 0;
  private wobbleVr = 0;
  private wobbleRotation = 0;
  private wobbleActive = false;

  // Target position for the main animation
  private targetX = 0;
  private targetY = 0;
  private scale = 1;

  // Pierres particles spawned at frame 61
  private pierres: PierreParticle[] = [];
  private pierresContainer: Container | null = null;
  private pierresActive = false;

  // Pierres particle texture
  private pierresTexture: Texture = Texture.EMPTY;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    this.scale = init.scale;
    this.targetX = init.targetX;
    this.targetY = init.targetY;

    // --- Background/ground loop animation (sprite_27) at target ---
    const bg27Anchor = calculateAnchor(SPRITE_27_MANIFEST);
    const bg27Textures = textures.getFrames('sprite_27');
    // AS: gotoAndPlay(random(30)) -> 0-indexed: random frame in [0, 29]
    const bgStartFrame = Math.floor(Math.random() * 30);
    this.bgAnim = this.anims.add(new FrameAnimatedSprite({
      textures: bg27Textures,
      anchorX: bg27Anchor.x,
      anchorY: bg27Anchor.y,
      scale: init.scale,
      loop: true,
      startFrame: bgStartFrame,
    }));
    this.bgAnim.sprite.position.set(init.targetX, init.targetY);
    this.container.addChild(this.bgAnim.sprite);

    // --- Main impact animation (sprite_42) at target ---
    const main42Anchor = calculateAnchor(SPRITE_42_MANIFEST);
    const main42Textures = textures.getFrames('sprite_42');
    this.mainAnim = this.anims.add(new FrameAnimatedSprite({
      textures: main42Textures,
      anchorX: main42Anchor.x,
      anchorY: main42Anchor.y,
      scale: init.scale,
    }));
    this.mainAnim.sprite.position.set(init.targetX, init.targetY);

    // Frame 1 (0-indexed: 0): play sound 'licrounch_1008'
    this.mainAnim.onFrame(0, () => {
      this.callbacks.playSound('licrounch_1008');
    });

    // Frame 7 (0-indexed: 6): activate wobble sprite (sprite_10 placed at frame 7)
    this.mainAnim.onFrame(6, () => {
      this.activateWobbleSprite(textures, init);
    });

    // Frame 55 (0-indexed: 54): play sound 'many_512b'
    this.mainAnim.onFrame(54, () => {
      this.callbacks.playSound('many_512b');
    });

    // Frame 61 (0-indexed: 60): this.end() -> signal hit; spawn 7 pierres
    this.mainAnim.onFrame(60, () => {
      this.signalHit();
      this.spawnPierres(init);
    });

    // Frame 211 (0-indexed: 210): removeMovieClip -> complete
    this.mainAnim.onFrame(210, () => {
      this.complete();
    });

    this.container.addChild(this.mainAnim.sprite);

    // Store wobble textures for later
    this.wobbleTextures = textures.getFrames('sprite_10');

    // Store pierres texture for later
    if (textures.hasTexture('lib_pierres')) {
      this.pierresTexture = textures.getFrames('lib_pierres')[0] ?? Texture.EMPTY;
    } else {
      const frames = textures.getFrames('lib_pierres_0');
      this.pierresTexture = frames.length > 0 ? frames[0] : Texture.EMPTY;
    }
  }

  private activateWobbleSprite(textures: SpellTextureProvider, init: SpellInitContext): void {
    if (this.wobbleActive) {
      return;
    }
    this.wobbleActive = true;

    // sprite_10 has 2 frames - wobble uses gotoAndStop(1) or gotoAndStop(2)
    // We'll use sprite_10 frame 0 as "frame 1" and frame 1 as "frame 2"
    const wobbleTextures = this.wobbleTextures.length > 0
      ? this.wobbleTextures
      : textures.getFrames('sprite_10');

    if (wobbleTextures.length === 0) {
      return;
    }

    const wobbleAnchor = calculateAnchor(SPRITE_10_MANIFEST);
    const wobbleSprite = new Sprite(wobbleTextures[0]);
    wobbleSprite.anchor.set(wobbleAnchor.x, wobbleAnchor.y);
    wobbleSprite.scale.set(init.scale);

    // AS: onClipEvent(load) { y = _Y; }
    // The sprite_10 is placed at some position within sprite_42's coordinate space
    // Since sprite_42 is placed at targetX, targetY, wobble is at (0, 0) relative to it
    this.wobbleBaseY = 0;
    wobbleSprite.position.set(0, 0);

    // State for AS wobble physics
    this.wobbleI = 0;
    this.wobbleVr = 0;
    this.wobbleRotation = 0;

    // Store texture references for frame switching
    this.wobbleTextures = wobbleTextures;
    this.wobbleSprite = wobbleSprite;

    // Add to mainAnim sprite (so it's in the same coordinate space as sprite_42)
    this.mainAnim.sprite.addChild(wobbleSprite);
  }

  private spawnPierres(init: SpellInitContext): void {
    if (this.pierresActive) {
      return;
    }
    this.pierresActive = true;

    // Create container for all pierres, positioned at target
    const pierresContainer = new Container();
    pierresContainer.position.set(this.targetX, this.targetY);
    this.container.addChild(pierresContainer);
    this.pierresContainer = pierresContainer;

    const pierresAnchor = calculateAnchor(PIERRES_MANIFEST);

    // AS: c = 0; while(c < 7) { this.attachMovie("pierres","pierres" + c, c); c++; }
    for (let c = 0; c < 7; c++) {
      // Each "pierres" symbol has an inner clip (PlaceObject2_2_1)
      // with onClipEvent(load) physics init

      // AS load:
      // vx = 5 * (Math.random() - 0.5)
      // vy = 2 * (Math.random() - 0.5)
      // _parent._x = 20 * (Math.random() - 0.5)  <- outer container x
      // _parent._y = 10 * (Math.random() - 0.5)  <- outer container y
      // t = 60 + 40 * Math.random()
      // _xscale = t; _yscale = t
      // _alpha = 20 + random(90)
      // v = -5 * Math.random() - 5
      // vr = 40 * (-0.5 + Math.random())

      const vx = 5 * (Math.random() - 0.5);
      const vy = 2 * (Math.random() - 0.5);
      const outerX = 20 * (Math.random() - 0.5);
      const outerY = 10 * (Math.random() - 0.5);
      const t = 60 + 40 * Math.random();
      const alpha = (20 + Math.floor(Math.random() * 90)) / 100;
      const v = -5 * Math.random() - 5;
      const vr = 40 * (-0.5 + Math.random());

      // Outer container (represents _parent of the inner clip = the "pierres" symbol root)
      const outerContainer = new Container();
      outerContainer.position.set(outerX * init.scale, outerY * init.scale);
      pierresContainer.addChild(outerContainer);

      // Inner sprite (the actual movie clip inside "pierres")
      const innerSprite = new Sprite(this.pierresTexture);
      innerSprite.anchor.set(pierresAnchor.x, pierresAnchor.y);
      innerSprite.scale.set((t / 100) * init.scale);
      innerSprite.alpha = alpha;
      innerSprite.position.set(0, 0);
      outerContainer.addChild(innerSprite);

      const particle: PierreParticle = {
        outerContainer,
        innerSprite,
        vx,
        vy,
        v,
        localY: 0,
        rotation: 0,
        vr,
        t,
        alpha,
      };

      this.pierres.push(particle);
    }
  }

  private updatePierres(): void {
    if (!this.pierresActive) {
      return;
    }

    for (const p of this.pierres) {
      // AS enterFrame:
      // _parent._x += vx;
      // _parent._y += vy;
      const outerPos = p.outerContainer.position;
      outerPos.x += p.vx * this.scale;
      outerPos.y += p.vy * this.scale;

      if (p.t !== 1) {
        // _Y = _Y + v;
        p.localY += p.v;

        // _rotation = _rotation + vr;
        p.rotation += p.vr;

        // v += 0.5;
        p.v += 0.5;

        // if(_Y > 0) { bounce/settle }
        if (p.localY > 0) {
          p.vx /= 2;
          p.vy /= 2;
          p.rotation = 0;
          p.localY = 0;
          p.v = (-p.v) / 4;

          if (Math.abs(p.v) < 1) {
            p.vx = 0;
            p.vy = 0;
            p.t = 1;
          }
        }

        // Apply local Y and rotation to inner sprite
        p.innerSprite.position.set(0, p.localY * this.scale);
        p.innerSprite.rotation = (p.rotation * Math.PI) / 180;
      }
    }
  }

  private updateWobble(): void {
    if (!this.wobbleActive || !this.wobbleSprite) {
      return;
    }

    // AS enterFrame for PlaceObject2_6_7 (sprite_10 wobble):
    // _X = (Math.random() - 0.5) * 5;
    // _Y = (Math.random() - 0.5) * 5 + y;
    const shakeX = (Math.random() - 0.5) * 5;
    const shakeY = (Math.random() - 0.5) * 5 + this.wobbleBaseY;
    this.wobbleSprite.position.set(shakeX * this.scale, shakeY * this.scale);

    // AS enterFrame for PlaceObject2_10_9 (sprite_10 frame toggle):
    // _rotation = _rotation + vr;
    // vr = 46.6 * Math.sin(i += Math.random());
    // if(Math.abs(vr) > 100) { gotoAndStop(2); } else { gotoAndStop(1); }
    this.wobbleRotation += this.wobbleVr;
    this.wobbleI += Math.random();
    this.wobbleVr = 46.6 * Math.sin(this.wobbleI);

    if (Math.abs(this.wobbleVr) > 100) {
      // gotoAndStop(2) -> frame index 1
      if (this.wobbleTextures.length > 1) {
        this.wobbleSprite.texture = this.wobbleTextures[1];
      }
    } else {
      // gotoAndStop(1) -> frame index 0
      if (this.wobbleTextures.length > 0) {
        this.wobbleSprite.texture = this.wobbleTextures[0];
      }
    }

    this.wobbleSprite.rotation = (this.wobbleRotation * Math.PI) / 180;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    this.anims.update(deltaTime);

    this.updateWobble();
    this.updatePierres();

    // Completion is handled by onFrame(210) callback calling this.complete()
    // But also check if mainAnim completed naturally (past frame 210)
    if (this.mainAnim.isComplete()) {
      this.complete();
    }
  }

  destroy(): void {
    // Clean up pierres
    if (this.pierresContainer) {
      this.pierresContainer.destroy({ children: true });
      this.pierresContainer = null;
    }
    this.pierres = [];

    super.destroy();
  }
}
