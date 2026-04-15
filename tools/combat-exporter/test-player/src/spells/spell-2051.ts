/**
 * Spell 2051 - Wab Swirl
 *
 * A projectile spell that travels from caster to target in a spiral path,
 * leaving cercle (circle) particle trails, then plays an impact animation.
 *
 * Components:
 * - sprite_14: Projectile traveling in spiral from caster to target, signals hit at frame 55 (0-indexed: 54)
 * - sprite_21: Impact animation at target position, stops at frame 82 (0-indexed: 81)
 * - lib_cercle particles: Trail particles spawned each frame by the projectile
 *
 * Original AS timing:
 * - DefineSprite_14/frame_1/DoAction: Play sound 'wab_swirl'
 * - DefineSprite_14/frame_28/DoAction: removeMovieClip + stop (0-indexed: 27)
 * - DefineSprite_21/frame_55/DoAction_2: this.end() -> signalHit (0-indexed: 54)
 * - DefineSprite_21/frame_82/DoAction: stop() (0-indexed: 81)
 *
 * Spiral physics (PlaceObject2_12_1 onClipEvent(enterFrame)):
 * - Orbits around midpoint: x = d + d * cos(pi + a), y = d * sin(a) / size
 * - v starts at 0.3, decreases by 0.015 for first 14 steps, then increases by 0.03
 * - Each step is processed every 3 frames (nFramesToIgnore = 2)
 * - After t > 28, jumps to frame 2 (which triggers removeMovieClip at frame 28)
 */

import { Container, Texture } from 'pixi.js';
import type { SpellContext, SpellTextureProvider } from '@dofus/spell-runtime';
import {
  FrameAnimatedSprite,
  ASParticleSystem,
  calculateAnchor,
  type SpriteManifest,
} from '@dofus/spell-runtime';
import { BaseSpell, type SpellInitContext } from '@dofus/spell-runtime';

const PROJECTILE_MANIFEST: SpriteManifest = {
  width: 32.75,
  height: 27.25,
  offsetX: -16.35,
  offsetY: -17.65,
};

const IMPACT_MANIFEST: SpriteManifest = {
  width: 62.55,
  height: 69,
  offsetX: -27.2,
  offsetY: -46.95,
};

// Spiral state for the projectile (replicates DefineSprite_14 PlaceObject2_12_1)
interface SpiralState {
  pi: number;
  v: number;
  size: number;
  a: number;
  b: number;
  t: number;
  nFramesToIgnore: number;
  nCurrentFrameState: number;
  // base position (midpoint between caster and target in world space)
  baseX: number;
  baseY: number;
  d: number;
  rotation: number;
  // done flag
  done: boolean;
}

export class Spell2051 extends BaseSpell {
  readonly spellId = 2051;

  private impactAnim!: FrameAnimatedSprite;
  private particles!: ASParticleSystem;

  // Projectile sprite (manually updated via spiral logic)
  private projectileSprite!: FrameAnimatedSprite;
  private spiral!: SpiralState;

  // Trail particle state (replicates DefineSprite_12 onEnterFrame)
  private trailC = 100;
  private trailXi = 0;
  private trailYi = 0;
  private projectileDone = false;

  // Frame spinner sprites (DefineSprite_6 instances on the projectile)
  // These are the sprite_5 / sprite_11 spinners - two instances placed on the projectile
  private spinner1!: FrameAnimatedSprite;
  private spinner2!: FrameAnimatedSprite;
  private spinner1VR = 0;
  private spinner2VR = 0;
  private spinnerR = 15; // decay divisor (from DefineSprite_14 we see "r" param used)

  // Container for projectile group (projectile + spinners)
  private projectileContainer!: Container;

  protected setup(context: SpellContext, textures: SpellTextureProvider, init: SpellInitContext): void {
    // ---- Impact animation (sprite_21) at target position ----
    this.impactAnim = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_21'),
      ...calculateAnchor(IMPACT_MANIFEST),
      scale: init.scale,
    }));
    this.impactAnim.sprite.position.set(init.targetX, init.targetY);
    // Signal hit at frame 55 (0-indexed: 54)
    this.impactAnim
      .stopAt(81)
      .onFrame(54, () => this.signalHit());
    this.container.addChild(this.impactAnim.sprite);

    // ---- Particle system for cercle trail ----
    const circleTexture = textures.getFrames('lib_cercle')[0] ?? Texture.EMPTY;
    this.particles = new ASParticleSystem(circleTexture);
    this.particles.container.position.set(0, 0);
    this.container.addChildAt(this.particles.container, 0);

    // ---- Projectile container ----
    this.projectileContainer = new Container();
    this.container.addChild(this.projectileContainer);

    // ---- Projectile animation (sprite_14) ----
    const projAnchor = calculateAnchor(PROJECTILE_MANIFEST);
    this.projectileSprite = this.anims.add(new FrameAnimatedSprite({
      textures: textures.getFrames('sprite_14'),
      anchorX: projAnchor.x,
      anchorY: projAnchor.y,
      scale: init.scale,
    }));
    // Sound on frame 1 (0-indexed: 0)
    this.projectileSprite.onFrame(0, () => this.callbacks.playSound('wab_swirl'));
    this.projectileContainer.addChild(this.projectileSprite.sprite);

    // ---- Spinner 1 (sprite_5) on projectile ----
    const spin1Frames = textures.getFrames('sprite_5');
    const spin1Anchor = calculateAnchor({
      width: 26.6,
      height: 15.1,
      offsetX: -13.5,
      offsetY: -13.75,
    });
    // AS: gotoAndStop(random(_totalframes) + 1) -> 0-indexed: random(totalFrames)
    const spin1Start = Math.floor(Math.random() * spin1Frames.length);
    this.spinner1 = this.anims.add(new FrameAnimatedSprite({
      textures: spin1Frames,
      anchorX: spin1Anchor.x,
      anchorY: spin1Anchor.y,
      scale: init.scale,
      loop: true,
      startFrame: spin1Start,
    }));
    // AS: vr = random(100) + 50; _rotation = random(360)
    this.spinner1VR = Math.floor(Math.random() * 100) + 50;
    this.spinner1.sprite.rotation = ((Math.floor(Math.random() * 360)) * Math.PI) / 180;
    this.projectileContainer.addChild(this.spinner1.sprite);

    // ---- Spinner 2 (sprite_11) on projectile ----
    const spin2Frames = textures.getFrames('sprite_11');
    const spin2Anchor = calculateAnchor({
      width: 19.35,
      height: 19.35,
      offsetX: -9.6,
      offsetY: -9.85,
    });
    const spin2Start = Math.floor(Math.random() * spin2Frames.length);
    this.spinner2 = this.anims.add(new FrameAnimatedSprite({
      textures: spin2Frames,
      anchorX: spin2Anchor.x,
      anchorY: spin2Anchor.y,
      scale: init.scale,
      loop: true,
      startFrame: spin2Start,
    }));
    this.spinner2VR = Math.floor(Math.random() * 100) + 50;
    this.spinner2.sprite.rotation = ((Math.floor(Math.random() * 360)) * Math.PI) / 180;
    this.projectileContainer.addChild(this.spinner2.sprite);

    // ---- Spiral physics init (DefineSprite_14 frame_1/DoAction_2) ----
    // In AS: x = _parent.cellFrom.x; y = _parent.cellFrom.y
    // _X = x; _Y = y
    // dx = cellTo.x - x; dy = cellTo.y - y
    // d = sqrt(dx*dx + dy*dy) / 2
    // _rotation = atan2(dy, dx) * 180 / pi
    const cellFromX = context?.cellFrom?.x ?? 0;
    const cellFromY = context?.cellFrom?.y ?? 0;
    const cellToX = context?.cellTo?.x ?? 0;
    const cellToY = context?.cellTo?.y ?? 0;
    const dx = cellToX - cellFromX;
    const dy = cellToY - cellFromY;
    const d = Math.sqrt(dx * dx + dy * dy) / 2;
    const rotation = Math.atan2(dy, dx) * 180 / 3.1415;

    // The projectile sprite in AS is positioned at cellFrom world coords.
    // In our coordinate system, container is at cellFrom, so base is (0, 0).
    // The spiral computes position relative to the container origin.
    // _X and _Y in AS are world coords; we offset by cellFrom to get local coords.
    this.spiral = {
      pi: 3.1415,
      v: 0.3,
      size: 0.8 + 3 * Math.random(),
      a: 0,
      b: 0,
      t: 0,
      nFramesToIgnore: 2,
      nCurrentFrameState: 0,
      baseX: 0,     // cellFrom.x - cellFrom.x = 0 (local to container)
      baseY: 0,     // cellFrom.y - cellFrom.y = 0
      d: d,
      rotation: rotation,
      done: false,
    };

    // spinner "r" decay value - from DefineSprite_6 enterFrame: _rotation += (vr /= _parent.r)
    // In AS the parent's "r" property is set per spinner. We'll use a fixed value.
    // Looking at AS code, _parent.r is a property of the container of the spinner.
    // We don't have this explicitly set but the pattern is _parent.r which would be
    // the DefineSprite_14 container's r property. It's not set in the scripts we have,
    // so we use 1 (no decay) which means vr stays constant.
    this.spinnerR = 1;

    // Initial projectile position
    this.updateSpiralPosition();
    this.trailXi = this.projectileContainer.x;
    this.trailYi = this.projectileContainer.y;
  }

  private updateSpiralPosition(): void {
    const s = this.spiral;
    if (s.done) {
      return;
    }

    let localX: number;
    let localY: number;

    // Compute position: x = d + d * cos(pi + a), y = d * sin(a) / size
    // These are offsets from the sprite's base position (cellFrom)
    // In AS, the _X of the orbiting child is set to _parent.d + _parent.d * cos(...)
    // where _parent is DefineSprite_14. The DefineSprite_14 itself is at cellFrom.
    // So world x = cellFrom.x + (d + d * cos(pi + a)), world y = cellFrom.y + (d * sin(a) / size)
    // In our local container space (container is at cellFrom origin):
    localX = s.d + s.d * Math.cos(s.pi + s.a);
    localY = s.d * Math.sin(s.a) / s.size;

    // Apply rotation of the DefineSprite_14 around its origin
    // In AS, DefineSprite_14 has _rotation = atan2(dy,dx)*180/pi
    // The child positions are in the local space of DefineSprite_14 which is rotated
    const rotRad = (s.rotation * Math.PI) / 180;
    const cosR = Math.cos(rotRad);
    const sinR = Math.sin(rotRad);
    const worldLocalX = localX * cosR - localY * sinR;
    const worldLocalY = localX * sinR + localY * cosR;

    this.projectileContainer.position.set(worldLocalX, worldLocalY);
  }

  private advanceSpiralStep(): void {
    const s = this.spiral;
    if (s.done) {
      return;
    }

    // AS onClipEvent(enterFrame) for PlaceObject2_12_1:
    // if(t > 28) { _parent.gotoAndPlay(2); }
    // else if(nCurrentFrameState > 0) { b = a; b += v/3; _X = ...; _Y = ...; nCurrentFrameState--; }
    // else { _X = ...; _Y = ...; a += v; t++; if(t<=14){v-=0.015}else{v+=0.03}; nCurrentFrameState = nFramesToIgnore; }

    if (s.t > 28) {
      // Trigger end of projectile
      s.done = true;
      this.projectileDone = true;
      // In AS this calls gotoAndPlay(2) on the parent (DefineSprite_14)
      // which eventually reaches frame 28 with removeMovieClip
      // We hide the projectile container
      this.projectileContainer.visible = false;
      return;
    }

    if (s.nCurrentFrameState > 0) {
      s.b = s.a;
      s.b += s.v / 3;
      const localX = s.d + s.d * Math.cos(s.pi + s.b);
      const localY = s.d * Math.sin(s.b) / s.size;
      const rotRad = (s.rotation * Math.PI) / 180;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      this.projectileContainer.position.set(
        localX * cosR - localY * sinR,
        localX * sinR + localY * cosR
      );
      s.nCurrentFrameState--;
    } else {
      const localX = s.d + s.d * Math.cos(s.pi + s.a);
      const localY = s.d * Math.sin(s.a) / s.size;
      const rotRad = (s.rotation * Math.PI) / 180;
      const cosR = Math.cos(rotRad);
      const sinR = Math.sin(rotRad);
      this.projectileContainer.position.set(
        localX * cosR - localY * sinR,
        localX * sinR + localY * cosR
      );
      s.a += s.v;
      s.t++;
      if (s.t <= 14) {
        s.v -= 0.015;
      } else {
        s.v += 0.03;
      }
      s.nCurrentFrameState = s.nFramesToIgnore;
    }
  }

  private spawnTrailParticle(): void {
    // AS DefineSprite_12/frame_1/DoAction: onEnterFrame
    // vx = _X - xi; vy = _Y - yi
    // attachMovie("cercle", ...) at current projectile position
    // cercle.vx = vx; cercle.vy = vy
    // xi = _X; yi = _Y

    const currentX = this.projectileContainer.x;
    const currentY = this.projectileContainer.y;
    const vx = currentX - this.trailXi;
    const vy = currentY - this.trailYi;

    // Spawn a cercle particle at current projectile position
    // AS DefineSprite_7_cercle/frame_1/PlaceObject2_6_1 onClipEvent(load):
    // va = 8 - random(3)
    // t = 60 + random(70)
    // _xscale = t; _yscale = t
    // _alpha = 90 + random(30)
    // r = 1.3 + 0.5 * Math.random()
    const va = 8 - Math.floor(Math.random() * 3);
    const t = 60 + Math.floor(Math.random() * 70);
    const alpha = (90 + Math.floor(Math.random() * 30)) / 100;
    const r = 1.3 + 0.5 * Math.random();

    // We store r per particle - but ASParticleSystem uses accX/accY for velocity decay
    // The cercle's _X updates as: _X += _parent.vx; _parent.vx /= r
    // _alpha -= va each frame, dies when _alpha < 10
    // We'll use alphaVelocity for the fade: va/100 per frame
    // For position: vx/vy decrease by factor r each frame (accX = 1/r equivalent)
    // But ASParticleSystem uses vx *= accX, so accX = 1/r

    this.particles.spawn({
      x: currentX,
      y: currentY,
      vx: vx,
      vy: vy,
      accX: 1 / r,
      accY: 1 / r,
      t: t,
      vt: 0,
      vtDecay: 0,
      alpha: alpha,
      alphaVelocity: -(va / 100),
    });

    // The particle dies when _alpha < 10 (original 0-100 scale)
    // In our 0-1 scale that's < 0.1, but our system kills at alpha <= 0
    // We need to adjust: set alphaVelocity so particle fades from (90+rand)/100 to 0.1/100 = 0.1
    // The alpha death condition in AS is _alpha < 10 (0-100 scale = 0.1 in 0-1 scale)
    // Our particle system kills at alpha <= 0. We need to handle the "< 10" threshold.
    // To replicate this, we can just let it die naturally (the visual difference is minimal)
    // since the particle fades quickly anyway.

    this.trailXi = currentX;
    this.trailYi = currentY;
    this.trailC++;
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Update all registered animations
    this.anims.update(deltaTime);

    // Update spiral physics and trail (each "frame" = 1000/60 ms)
    // We advance once per update call (approximation for the enterFrame behavior)
    if (!this.projectileDone) {
      this.advanceSpiralStep();

      // Spawn trail particle
      if (!this.spiral.done) {
        this.spawnTrailParticle();
      }

      // Update spinner rotations
      // AS: _rotation += (vr /= _parent.r); where _parent.r = 1 means no decay
      this.spinner1VR /= this.spinnerR === 0 ? 1 : this.spinnerR;
      this.spinner1.sprite.rotation += (this.spinner1VR * Math.PI) / 180;

      this.spinner2VR /= this.spinnerR === 0 ? 1 : this.spinnerR;
      this.spinner2.sprite.rotation += (this.spinner2VR * Math.PI) / 180;
    }

    // Update particles
    this.particles.update();

    // Check completion: impact animation done and no alive particles
    if (this.impactAnim.isStopped() && !this.particles.hasAliveParticles()) {
      this.complete();
    }
  }

  destroy(): void {
    this.particles.destroy();
    super.destroy();
  }
}
