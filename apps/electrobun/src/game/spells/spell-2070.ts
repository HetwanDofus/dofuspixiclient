/**
 * Spell 2070 - Fulminant/Lightning orb
 *
 * Three orbs fly from caster position toward the target cell.
 * Each orb wanders randomly, then locks onto the target.
 * On arrival, the orb plays its impact animation and signals hit.
 *
 * Components:
 * - sprite_3 (x4): orb instances at caster position, navigating to target
 *   - PlaceObject2_3_1: t threshold=45, initial vr range=20
 *   - PlaceObject2_3_5: t threshold=55, initial vr range=30
 *   - PlaceObject2_3_7: t threshold=65, initial vr range=30
 *   - PlaceObject2_3_9: t threshold=75, initial vr range=30
 *
 * Original AS timing:
 * - Frame 2 (main): stop + place 4 orb clips
 * - DefineSprite_3 frame 1: stop()
 * - DefineSprite_3 frame 25: stop()
 * - DefineSprite_3 frame 55: begin fading (_alpha -= 3 per frame)
 * - DefineSprite_3 frame 91: stop + removeMovieClip()
 * - Orb reaches target (_b): fin=1 -> this.end() -> signalHit
 *
 * The "orb" sprite has:
 *  - frame 0 (AS frame 1): stop — starts frozen
 *  - Then play() is called when it arrives at target (fin becomes 1 sets play)
 *  - frame 24 (AS frame 25): stop — holds at impact
 *  - frame 54 (AS frame 55): starts fading
 *  - frame 90 (AS frame 91): dies
 *
 * In this implementation there is no inner "boule" sub-sprite to scale,
 * so the boule xscale/yscale lines are omitted (no visible sub-clip).
 *
 * The "a" reference in orbs 5/7/9 refers to something at cellTo — per AS:
 *   PlaceObject2_4_3 onClipEvent(load): _X = _parent.cellTo.x; _Y = _parent.cellTo.y
 * So "a" = target marker and "b" = also target marker (both at cellTo).
 * Orb _1 uses _parent.b for homing and proximity.
 * Orbs _5/_7/_9 use _parent.a for homing and _parent.b for proximity check.
 * Both a and b are at cellTo so the behaviour is identical.
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

const ORB_MANIFEST: SpriteManifest = {
  width: 141.1,
  height: 141.1,
  offsetX: -75.55,
  offsetY: -70.95,
};

interface OrbState {
  /** screen-space x (relative to container) */
  x: number;
  /** screen-space y (relative to container) */
  y: number;
  angle: number;
  angle2: number;
  vr: number;
  v: number;
  v2: number;
  vx: number;
  vy: number;
  t: number;
  fin: number;
  /** frame counter that increments each AS enterFrame */
  tCounter: number;
  /** threshold after which homing begins */
  homingThreshold: number;
  /** initial vr random range multiplier */
  initVrRange: number;
  anim: FrameAnimatedSprite;
  /** Whether this orb has already signalled hit */
  hitDone: boolean;
  /** Whether this orb animation is fully complete */
  animDone: boolean;
  /** alpha for fading (0-100 percentage, matching AS _alpha) */
  alpha: number;
  /** whether fading has started */
  fading: boolean;
  /** inner frame counter for the impact anim (plays from frame 1 in AS = 0 in TS) */
  impactPlaying: boolean;
}

export class Spell2070 extends BaseSpell {
  readonly spellId = 2070;

  private orbs: OrbState[] = [];
  private orbsContainer!: Container;

  /** target position relative to container origin (cellFrom) */
  private targetRelX = 0;
  private targetRelY = 0;

  /**
   * Starting position relative to container origin.
   * AS: _X = _parent.cellFrom.x; _Y = _parent.cellFrom.y - 140
   * Since the container is placed at cellFrom we just use (0, -140).
   */
  private readonly startRelY = -140;

  protected setup(
    context: SpellContext,
    textures: SpellTextureProvider,
    init: SpellInitContext
  ): void {
    const orbTextures = textures.getFrames("sprite_3");
    const anchor = calculateAnchor(ORB_MANIFEST);

    // Container positioned at cellFrom
    this.orbsContainer = new Container();
    this.orbsContainer.scale.set(init.scale);
    this.container.addChild(this.orbsContainer);

    // Target position relative to cellFrom
    this.targetRelX = (context?.cellTo?.x ?? 0) - (context?.cellFrom?.x ?? 0);
    this.targetRelY = (context?.cellTo?.y ?? 0) - (context?.cellFrom?.y ?? 0);

    // Define the four orb configs (matching PlaceObject2_3_1, _5, _7, _9)
    const orbConfigs: { homingThreshold: number; initVrRange: number }[] = [
      { homingThreshold: 45, initVrRange: 20 }, // _3_1
      { homingThreshold: 55, initVrRange: 30 }, // _3_5
      { homingThreshold: 65, initVrRange: 30 }, // _3_7
      { homingThreshold: 75, initVrRange: 30 }, // _3_9
    ];

    for (const cfg of orbConfigs) {
      // AS: vr = (-0.5 + Math.random()) * range
      const initialVr = (-0.5 + Math.random()) * cfg.initVrRange;

      // Create the orb animation — starts stopped at frame 0 (AS frame 1 has stop())
      const anim = new FrameAnimatedSprite({
        textures: orbTextures,
        anchorX: anchor.x,
        anchorY: anchor.y,
      });

      // The orb starts stopped (AS frame 1: stop())
      anim.pause();

      // Position at start (will be overridden in state, but set for display)
      anim.sprite.position.set(0, this.startRelY);
      this.orbsContainer.addChild(anim.sprite);

      const state: OrbState = {
        x: 0,
        y: this.startRelY,
        angle: -90,
        angle2: -90,
        vr: initialVr,
        v: 10,
        v2: 10,
        vx: 0,
        vy: 0,
        t: 0,
        fin: 0,
        tCounter: 0,
        homingThreshold: cfg.homingThreshold,
        initVrRange: cfg.initVrRange,
        anim,
        hitDone: false,
        animDone: false,
        alpha: 100,
        fading: false,
        impactPlaying: false,
      };

      this.orbs.push(state);
    }
  }

  update(deltaTime: number): void {
    if (this.done) {
      return;
    }

    // Each call to update() represents one "enterFrame" tick for the physics,
    // but we need to accumulate time properly for the frame-based animations.
    // The FrameAnimatedSprite.update() handles deltaTime accumulation internally.
    // For the physics we simulate one AS enterFrame per 1000/60 ms elapsed.
    // We drive physics at the same rate as the animation frames (60fps).

    const FRAME_MS = 1000 / 60;
    // We'll process physics ticks proportional to deltaTime
    // but for simplicity (and correctness to AS), we run one tick per update call
    // since the test player calls update() at 60fps.
    // Actually we need to accumulate and tick properly:

    this.physicsAccumulator = (this.physicsAccumulator ?? 0) + deltaTime;

    while (this.physicsAccumulator >= FRAME_MS) {
      this.physicsAccumulator -= FRAME_MS;
      this.tickPhysics();
    }

    // Update all orb animations
    for (const orb of this.orbs) {
      if (!orb.animDone) {
        if (orb.impactPlaying) {
          orb.anim.update(deltaTime);
        }

        // Apply fading
        if (orb.fading) {
          // AS: _parent._alpha -= 3 per enterFrame
          // We do it per delta proportionally — but AS does it per frame, so tie to physicsAccumulator ticks
          // Actually handled in tickPhysics already
        }

        // Sync position to sprite
        orb.anim.sprite.position.set(orb.x, orb.y);
        orb.anim.sprite.alpha = Math.max(0, orb.alpha / 100);

        // Check completion
        if (orb.impactPlaying && orb.anim.isComplete()) {
          orb.animDone = true;
        }

        // If alpha <= 0, done
        if (orb.alpha <= 0) {
          orb.animDone = true;
          orb.anim.sprite.visible = false;
        }
      }
    }

    // Check overall completion: all orbs done
    if (this.orbs.every((o) => o.animDone)) {
      this.complete();
    }
  }

  private physicsAccumulator = 0;

  private tickPhysics(): void {
    for (const orb of this.orbs) {
      if (orb.animDone) {
        continue;
      }

      if (orb.fin === 0) {
        // Random vr change: AS random(9) == 1 (1/9 chance)
        if (Math.floor(Math.random() * 9) === 1) {
          orb.vr = (-0.5 + Math.random()) * 40;
        }

        // Orb _1 (homingThreshold=45) has different logic: homing uses _parent.b
        // Orbs _5/_7/_9 (homingThreshold=55/65/75) use _parent.a for homing
        // Both a and b are at cellTo, so behaviour is identical

        if (orb.homingThreshold === 45) {
          // PlaceObject2_3_1 logic
          if (orb.tCounter++ > 45) {
            // home toward target (b)
            orb.angle =
              (Math.atan2(this.targetRelY - orb.y, this.targetRelX - orb.x) *
                180) /
              Math.PI;
            orb.vr = (-0.5 + Math.random()) * 15;
          }
          orb.v = 23 - Math.abs(orb.vr) * 0.5;
          orb.v2 -= (orb.v2 - orb.v) / 3;
          orb.v /= 2;
          orb.v2 /= 2;
          orb.angle += orb.vr;
        } else {
          // PlaceObject2_3_5/_7/_9 logic
          orb.v = 30 - Math.abs(orb.vr) * 0.5;
          orb.v2 -= (orb.v2 - orb.v) / 3;
          orb.v /= 2;
          orb.v2 /= 2;
          orb.angle += orb.vr;
          if (orb.tCounter++ > orb.homingThreshold) {
            // home toward a (= target)
            orb.angle =
              (Math.atan2(this.targetRelY - orb.y, this.targetRelX - orb.x) *
                180) /
              Math.PI;
            orb.v = 1;
          }
        }

        orb.angle2 -= (orb.angle2 - orb.angle) / 2;
        orb.anim.sprite.rotation = (orb.angle2 * Math.PI) / 180;

        const angle2Rad = (orb.angle2 * Math.PI) / 180;
        orb.vx = orb.v2 * 2 * Math.cos(angle2Rad);
        orb.vy = orb.v2 * Math.sin(angle2Rad);
      }

      // Proximity check vs target (b = cellTo)
      if (
        Math.abs(this.targetRelY - orb.y) < 20 &&
        Math.abs(this.targetRelX - orb.x) < 20 &&
        orb.fin === 0
      ) {
        orb.fin = 1;
        // AS: this.play() — start impact animation from frame 1 (0-indexed: 0)
        orb.anim.play();
        orb.impactPlaying = true;

        // Register frame callbacks on the impact anim
        orb.anim.onFrame(24, () => {
          // AS frame 25: stop()
          orb.anim.stopAt(24);
        });
        orb.anim.onFrame(54, () => {
          // AS frame 55: start fading
          orb.fading = true;
        });
        orb.anim.onFrame(90, () => {
          // AS frame 91: stop + removeMovieClip
          orb.animDone = true;
          orb.anim.sprite.visible = false;
        });

        orb.vx = 0;
        orb.vy = 0;
      }

      if (orb.fin === 1) {
        // AS: this.end() — signal hit
        if (!orb.hitDone) {
          orb.hitDone = true;
          this.signalHit();
        }
        orb.fin = 2;
        orb.vx = 0;
        orb.vy = 0;
      }

      // Apply fading per physics tick
      if (orb.fading) {
        orb.alpha -= 3;
      }

      // Update position
      orb.x += orb.vx;
      orb.y += orb.vy;

      // Update impact animation
      if (
        orb.impactPlaying &&
        !orb.anim.isStopped() &&
        !orb.anim.isComplete()
      ) {
        orb.anim.update(1000 / 60);
      }
    }
  }

  destroy(): void {
    super.destroy();
  }
}
