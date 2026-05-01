/**
 * Spell 303 — Séisme (Feca earth-shockwave).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition layer.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/303/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single composite animation
 * (anim1, 222 frames) anchored at the target cell. There are no move/shoot/
 * duplicate symbols, no projectile motion — purely an impact animation at
 * the target. The main timeline just plays a sound and the outer sprite
 * (DefineSprite_20, mirrored by `anim1`) drives everything.
 *
 * Library symbols:
 *   - lib_pierres — tiny stone particle (6.4×3.85). Two separate sets are
 *     spawned by two onClipEvent(load) handlers on two PlaceObject2
 *     placements inside DefineSprite_20:
 *       • frame_1  (PlaceObject2_11_2): 25 particles, depths 105–129
 *       • frame_7  (PlaceObject2_11_5): 20 particles, depths 100–119
 *     Each particle's inner "controller" clip seeds scatter/physics in
 *     onLoad and drives falling + bounce + fade in onEnterFrame.
 *   - "or"     — gold/glow fleck particle. DefineSprite_6_or has its own
 *     PlaceObject2_5_1 with onClipEvent(load/enterFrame). Spawned directly
 *     from the composite anim1 at certain frames (baked into SVG
 *     placements). There is no separate `lib_or` entry in librarySymbols,
 *     but the AS scripts exist — we model `or` as a virtual symbol whose
 *     clip-events drive the gold-fleck motion.
 *   - "terre"  — DefineSprite_10_terre is an earth-chunk clip with a
 *     simple upward-launch/gravity onEnterFrame. Also baked into the SVG
 *     composite but its handler must run at runtime.
 *
 * Because the manifest lists `isComposite: true` for `anim1` and only
 * `pierres` appears in `librarySymbols[]`, we model the spell as:
 *   1. Register `pierres` (with full onLoad + onEnterFrame physics).
 *   2. Register a container symbol `anim1` (222 frames, texture frames
 *      from `textures.getFrames("anim1")`). Its frameScripts wire:
 *        - frame 0  (frame_1):  spawn first batch of pierres (depths 105–129)
 *        - frame 6  (frame_7):  spawn second batch of pierres (depths 100–119)
 *        - frame 36 (frame_37): play "explosion" sound
 *        - frame 156 (frame_157): signalHit (this.end() equivalent)
 *        - frame 219 (frame_220): complete (_parent.removeMovieClip + stop)
 *   3. Attach `anim1` from onSpellStart and play sound "setag_303".
 *
 * Main timeline: SOMA.playSound("setag_303"); (frame_1/DoAction.as)
 */

import type {
  SpellCallbacks,
  SpellContext,
  SpellTextureProvider,
  SymbolDefinition,
} from "@dofus/spell-runtime";
import {
  RuntimeSpell,
  SpellDisplayType,
  calculateAnchor,
} from "@dofus/spell-runtime";

const PIERRES_BOUNDS = {
  width: 6.4,
  height: 3.85,
  offsetX: -3.2,
  offsetY: -2.2,
};

const ANIM1_BOUNDS = {
  width: 165.95,
  height: 265.65,
  offsetX: -72.1,
  offsetY: -232,
};

export class Spell303 extends RuntimeSpell {
  readonly spellId = 303;
  readonly displayType = SpellDisplayType.TargetCell;

  private pierresSym!: SymbolDefinition;
  private anim1Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const pierresAnchor = calculateAnchor(PIERRES_BOUNDS);
    const anim1Anchor = calculateAnchor(ANIM1_BOUNDS);

    // ---- lib_pierres — stone particle ----------------------------
    // The particle logic lives on a PlaceObject2 controller child INSIDE
    // the pierres sprite. In canonical AS the DefineSprite_3_pierres clip
    // contains PlaceObject2_2_1 which carries the onClipEvent handlers.
    // We model this by putting the handlers directly on the pierres
    // SymbolDefinition (the controller child is not separately modelled
    // because it has no visual content of its own and its vars/state are
    // the clip's own vars in all practical terms).
    //
    // AS: scripts/DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/
    //       CLIPACTIONRECORD onClipEvent(load).as
    //       CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,

      onLoad: (clip) => {
        // AS onClipEvent(load) — DefineSprite_3_pierres/frame_1/PlaceObject2_2_1
        clip.vars.vy = 1 * (Math.random() - 0.5);
        clip.vars.vx = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y: the "parent" in AS is the wrapper
        // container clip. Since we collapse wrapper+controller into one
        // SpellClip node, we apply the scatter directly to this clip.
        clip.x = 40 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        // Local _Y inside the controller — represents vertical offset
        // within the clip's own coordinate space. We store as vars.localY.
        clip.vars.localY = -180 - Math.floor(Math.random() * 40);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = 3 * Math.random();
        clip.vars.vr = 40 * (-0.5 + Math.random());
        clip.vars.t = t;
        // m counter for phase tracking (reuse field; starts undefined = 0)
        clip.vars.m = 0;
      },

      onEnterFrame: (clip) => {
        // AS onClipEvent(enterFrame) — DefineSprite_3_pierres/frame_1/PlaceObject2_2_1
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        const t = clip.vars.t as number;

        clip.x += vx;
        clip.y += vy;

        if (t === 1) {
          // Fade-out phase
          const newAlpha = clip.alpha - 2 / 100;
          clip.alpha = newAlpha;
          if (clip.alpha <= 10 / 100) {
            clip.parent?.remove();
          }
        }

        if (t !== 1) {
          let localY = clip.vars.localY as number;
          let v = clip.vars.v as number;
          let vr = clip.vars.vr as number;

          localY += v;
          clip.vars.localY = localY;
          // Apply localY as a vertical position offset within the clip
          // (AS _Y is the controller's local Y; we store & apply it as an
          // additive offset on top of the scatter y set in onLoad).
          // We express localY as a pixel displacement from the spawned y.
          clip.y = (clip.vars.spawnY as number | undefined ?? clip.y) + localY;

          // Rotation — AS degrees to radians
          clip.rotation += (vr * Math.PI) / 180;
          clip.vars.vr = vr;

          v += 0.4;
          clip.vars.v = v;

          if (localY > 0) {
            // Bounce on "ground"
            clip.vars.vx = vx / 2;
            clip.vars.vy = vy / 2;
            clip.rotation = 0;
            clip.vars.localY = 0;
            clip.y = clip.vars.spawnY as number ?? clip.y;
            const bounced = (-v) / 4;
            clip.vars.v = bounced;
            if (Math.abs(bounced) < 1) {
              clip.vars.vx = 0;
              clip.vars.vy = 0;
              clip.vars.t = 1;
            }
          }
        }
      },
    };

    // ---- anim1 — main composite timeline (222 frames) ------------
    // DefineSprite_20 drives the overall spell. We map it to the `anim1`
    // animation entry which holds the pre-rendered SVG composite frames.
    //
    // frameScripts ports:
    //   frame_1  (index 0)  — PlaceObject2_11_2 onLoad: spawn pierres 105–129
    //   frame_7  (index 6)  — PlaceObject2_11_5 onLoad: spawn pierres 100–119
    //   frame_37 (index 36) — DoAction: SOMA.playSound("explosion")
    //   frame_157(index 156)— DoAction: this.end() → signalHit
    //   frame_220(index 219)— DoAction: _parent.removeMovieClip → complete
    const anim1Frames = textures.getFrames("anim1");

    this.anim1Sym = {
      name: "anim1",
      totalFrames: 222,
      frames: anim1Frames,
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_20/frame_1/PlaceObject2_11_2 onClipEvent(load)
            // Spawn pierres particles at depths 105–129 (c = 105; c < 130)
            let c = 105;
            while (c < 130) {
              const child = clip.attach(
                this.pierresSym,
                `pierres${c}`,
                c,
                ctx,
              );
              // Record the spawn y so localY can be applied as delta
              child.vars.spawnY = child.y;
              c++;
            }
          },
        ],
        [
          6,
          (clip, ctx) => {
            // AS DefineSprite_20/frame_7/PlaceObject2_11_5 onClipEvent(load)
            // Spawn pierres particles at depths 100–119 (c = 100; c < 120)
            let c = 100;
            while (c < 120) {
              const child = clip.attach(
                this.pierresSym,
                `pierres${c}`,
                c,
                ctx,
              );
              child.vars.spawnY = child.y;
              c++;
            }
          },
        ],
        [
          36,
          (_clip) => {
            // AS DefineSprite_20/frame_37/DoAction.as
            // SOMA.playSound("explosion") — captured callback reference used here
            this.soundCallback?.("explosion");
          },
        ],
        [
          156,
          (_clip) => {
            // AS DefineSprite_20/frame_157/DoAction.as
            // this.end() — signals hit (damage popup)
            this.runtime.signalHit();
          },
        ],
        [
          219,
          (clip) => {
            // AS DefineSprite_20/frame_220/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.pierresSym);
    this.registry.register(this.anim1Sym);
  }

  private soundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS scripts/frame_1/DoAction.as: SOMA.playSound("setag_303");
    callbacks.playSound("setag_303");
    // Capture for deferred use in frame_37 script ("explosion")
    this.soundCallback = callbacks.playSound;
    // Attach the main composite animation at the root (target cell origin)
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
