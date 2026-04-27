/**
 * Spell 303 — Tremblement de Terre (Feca earth shake).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/303/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell has a single composite animation
 * (anim1, 222 frames) rendered at the target cell. There are no `move` or
 * `shoot` symbols, no projectile arc, no beam — just an impact-at-target
 * sequence. The manifest's `librarySymbols` array contains only `pierres`
 * (the stone particle). The main outer sprite (DefineSprite_20) is the
 * primary timeline and drives all timing; `anim1` supplies its frame textures.
 *
 * Library symbols:
 *   - `pierres` — single-frame stone chip particle.
 *       onLoad: seeds vx, vy, _Y start (falling from above), scale, alpha,
 *               gravity speed v, rotation-speed vr. Also scatters parent.
 *       onEnterFrame: integrates falling + bounce physics; fades and removes
 *                     itself when small enough.
 *   - `or` — golden sparkle particle (NOT in librarySymbols[]; the AS
 *             `attachMovie("or",…)` reference is inside DefineSprite_6_or but
 *             that symbol itself is only referenced internally — it has no
 *             manifest librarySymbols entry. Looking at the script paths:
 *             `DefineSprite_6_or` is a library symbol the outer DefineSprite_20
 *             attaches. However, since it is absent from `librarySymbols[]` in
 *             the manifest it has no separate texture strip; we treat it as a
 *             container-only symbol with a single placeholder frame.)
 *
 * Wait — re-reading the manifest carefully: `librarySymbols` only has `pierres`.
 * The script paths show two distinct particle symbols:
 *   DefineSprite_3_pierres  → name "pierres"
 *   DefineSprite_6_or       → name "or"   (implied by frame_7 onClipEvent(load)
 *                             attaching "pierres", and frame_1 attaching "pierres"
 *                             too — but the `or` symbol is ONLY referenced in
 *                             DefineSprite_6_or's own clip events, which belong
 *                             to an inner clip placed INSIDE "or". The outer
 *                             DefineSprite_20 never calls attachMovie("or",...).
 *                             Only `attachMovie("pierres",...)` is visible in
 *                             the DefineSprite_20 frame clip events.)
 *
 * Actually reading the DefineSprite_20 onClipEvent scripts more carefully:
 *   frame_7  PlaceObject2_11_5 onClipEvent(load): attachMovie("pierres",…) ×20
 *   frame_1  PlaceObject2_11_2 onClipEvent(load): attachMovie("pierres",…) ×25
 *
 * So "or" is never attachMovie'd from the outer timeline; it is a placed
 * child of DefineSprite_20's authored content (PlaceObject2_5 = the "or"
 * symbol, which is placed automatically by the SWF). The DefineSprite_6_or
 * script is the clip-event handler for that placed child.
 *
 * For our runtime, DefineSprite_20 IS the top-level anim1 (the 222-frame
 * composite). We register `anim1` as the root symbol and drive:
 *   - frame_1 (0-indexed): attach 25 `pierres` particles (PlaceObject2_11_2 load)
 *   - frame_7 (0-indexed 6): attach 20 more `pierres` particles
 *   - frame_37 (0-indexed 36): play "explosion" sound
 *   - frame_157 (0-indexed 156): this.end() → signalHit
 *   - frame_220 (0-indexed 219): _parent.removeMovieClip → complete
 *
 * The "or" (gold sparkle) child described by DefineSprite_6_or is an authored
 * placed child of the outer timeline. Since the runtime doesn't replay authored
 * PlaceObject entries, we skip it — its visuals are baked into anim1's composite
 * frames by the exporter.
 *
 * Main timeline frame_1: SOMA.playSound("setag_303").
 *
 * Timing signals:
 *   - signalHit at frame_157 (0-indexed 156) — canonical `this.end()` call.
 *   - complete  at frame_220 (0-indexed 219) — canonical `_parent.removeMovieClip()`.
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

    // ---- lib_pierres — falling stone chip particle ---------------
    // Registered from manifest librarySymbols[0]: name="pierres",
    // totalFrames=1, bounds as above.
    //
    // onLoad ports:
    //   DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(load).as
    //
    // onEnterFrame ports:
    //   DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    //
    // Note: AS uses _X/_Y to move the inner child (the clip event is on
    // a child sprite placed inside pierres), while _parent._x/_y moves
    // the outer "pierres" container. In our runtime, SpellClip exposes
    // only one transform layer, so we collapse both: x/y is the world
    // offset (was _parent._x/_y) and the "local _Y" fall offset is
    // stored in vars.localY and accumulated into clip.y each frame.
    this.pierresSym = {
      name: "pierres",
      totalFrames: 1,
      frames: textures.getFrames("lib_pierres"),
      anchorX: pierresAnchor.x,
      anchorY: pierresAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(load)
        clip.vars.vy = 1 * (Math.random() - 0.5);
        clip.vars.vx = 2 * (Math.random() - 0.5);
        // _parent._x / _parent._y scatter applied as initial position offset
        clip.x = 40 * (Math.random() - 0.5);
        clip.y = 10 * (Math.random() - 0.5);
        // Local _Y starts high above (negative = up in Flash)
        clip.vars.localY = -180 - Math.floor(Math.random() * 40);
        const t = 60 + 40 * Math.random();
        clip.scaleX = t / 100;
        clip.scaleY = t / 100;
        clip.alpha = (20 + Math.floor(Math.random() * 90)) / 100;
        clip.vars.v = 3 * Math.random();
        clip.vars.vr = 40 * (-0.5 + Math.random());
        clip.vars.t = t; // repurposed: t != 1 means "still falling", t == 1 means "fading"
        clip.vars.fadingMode = false;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_3_pierres/frame_1/PlaceObject2_2_1/onClipEvent(enterFrame)
        const vx = clip.vars.vx as number;
        const vy = clip.vars.vy as number;
        clip.x += vx;
        clip.y += vy;

        const fadingMode = clip.vars.fadingMode as boolean;

        if (fadingMode) {
          // AS: t == 1 branch — fade out
          const alpha = clip.alpha;
          const newAlpha = alpha - 2 / 100;
          clip.alpha = newAlpha;
          if (newAlpha <= 10 / 100) {
            clip.remove();
          }
        } else {
          // AS: t != 1 branch — fall + bounce physics
          let localY = clip.vars.localY as number;
          let v = clip.vars.v as number;
          let vr = clip.vars.vr as number;
          let curVx = clip.vars.vx as number;
          let curVy = clip.vars.vy as number;

          localY += v;
          // AS: _rotation = _rotation + vr → delta in degrees → convert to radians
          clip.rotation += (vr * Math.PI) / 180;
          v += 0.4;

          if (localY > 0) {
            // Bounce
            curVx /= 2;
            curVy /= 2;
            clip.rotation = 0;
            localY = 0;
            v = (-v) / 4;
            if (Math.abs(v) < 1) {
              curVx = 0;
              curVy = 0;
              clip.vars.fadingMode = true;
            }
          }

          clip.vars.localY = localY;
          clip.vars.v = v;
          clip.vars.vr = vr;
          clip.vars.vx = curVx;
          clip.vars.vy = curVy;

          // Render the local Y offset into the clip's y position.
          // We add localY on top of the scatter offset that was applied in onLoad.
          // To avoid double-accumulation, store the base offset separately.
          // We use a "baseY" to keep track of the scatter component.
          // Actually, re-check AS semantics:
          //   _parent._x += vx  → moves container
          //   _Y = _Y + v       → moves inner child's local Y
          // In our single-transform model we folded both into clip.x/y.
          // The _parent drift is already applied above (clip.x += vx, clip.y += vy).
          // The _Y accumulation should be a separate offset. We store it in vars.localY
          // and apply it by adjusting y relative to baseY each frame.
          // Set clip.y to scatter_base + localY.
          // Since clip.x/y starts at scatter position (set in onLoad) and we
          // just added vx/vy drift each frame, we need to also incorporate localY.
          // The simplest correct model: store base scatter separately.
          // However, since onLoad sets clip.y = scatter and enterFrame adds vy
          // continuously, we need to add localY as an additional offset on top.
          // We track "lastLocalY" so we can apply the delta.
          const lastLocalY = (clip.vars.lastLocalY as number) ?? 0;
          clip.y += localY - lastLocalY;
          clip.vars.lastLocalY = localY;
        }
      },
    };

    // ---- anim1 — the main outer DefineSprite_20 composite --------
    // This is the primary 222-frame timeline (DefineSprite_20 in AS).
    // It holds the composite animation frames (anim1_*.svg) and drives
    // all frame-script events: particle spawns, sound, signalHit, complete.
    //
    // Frame scripts port:
    //   DefineSprite_20/frame_1 PlaceObject2_11_2 onClipEvent(load) → spawn 25 pierres
    //   DefineSprite_20/frame_7 PlaceObject2_11_5 onClipEvent(load) → spawn 20 pierres
    //   DefineSprite_20/frame_37/DoAction.as → playSound("explosion")
    //   DefineSprite_20/frame_157/DoAction.as → signalHit
    //   DefineSprite_20/frame_220/DoAction.as → complete
    //
    // The PlaceObject2 onClipEvent(load) handlers fire when the placed
    // child is first visible — that maps to the frame on which the
    // PlaceObject2 tag appears (frame_1 and frame_7 respectively).
    // We fire them as frameScripts on those frames.
    this.anim1Sym = {
      name: "anim1",
      totalFrames: 222,
      frames: textures.getFrames("anim1"),
      anchorX: anim1Anchor.x,
      anchorY: anim1Anchor.y,
      frameScripts: new Map([
        [
          // AS: DefineSprite_20/frame_1 PlaceObject2_11_2 onClipEvent(load)
          // c = 105; while (c < 130) { attachMovie("pierres","pierres"+c,c); c++; }
          // That's 25 particles (c = 105..129 inclusive).
          0,
          (clip, ctx) => {
            for (let c = 105; c < 130; c++) {
              clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
            }
          },
        ],
        [
          // AS: DefineSprite_20/frame_7 PlaceObject2_11_5 onClipEvent(load)
          // c = 100; while (c < 120) { attachMovie("pierres","pierres"+c,c); c++; }
          // That's 20 particles (c = 100..119 inclusive).
          6,
          (clip, ctx) => {
            for (let c = 100; c < 120; c++) {
              clip.attach(this.pierresSym, `pierres${c}`, c, ctx);
            }
          },
        ],
        [
          // AS: DefineSprite_20/frame_37/DoAction.as → SOMA.playSound("explosion")
          // Sound triggered mid-animation at the impact flash frame.
          36,
          (_clip) => {
            this.soundCallback?.("explosion");
          },
        ],
        [
          // AS: DefineSprite_20/frame_157/DoAction.as → this.end()
          // Canonical hit signal — damage popup appears here.
          156,
          (_clip) => {
            this.runtime.signalHit();
          },
        ],
        [
          // AS: DefineSprite_20/frame_220/DoAction.as → _parent.removeMovieClip(); stop();
          // Spell complete — outer mc removed.
          219,
          (clip) => {
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
    // Capture sound callback for use inside frame_37 script.
    this.soundCallback = callbacks.playSound;

    // AS: frame_1/DoAction.as → SOMA.playSound("setag_303")
    callbacks.playSound("setag_303");

    // Attach the main anim1 timeline at the root. For TargetCell the
    // container is already positioned at the target cell, so the
    // anim1 child sits at (0,0) relative to the container.
    this.root.attach(this.anim1Sym, "anim1", 1, context);
  }
}
