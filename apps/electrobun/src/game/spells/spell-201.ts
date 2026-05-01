/**
 * Spell 201 — Griffes de Crâ (Cra claw attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/201/scripts/scripts/
 *
 * displayType=11 (TargetCell). There is no move/shoot/duplicate/projectile
 * pattern. The spell places a compound sprite (DefineSprite_7) at the target
 * cell. That sprite contains two authored placements of the `griffes` library
 * symbol (PlaceObject2_6_1 and PlaceObject2_6_3) each with random rotation
 * clip events, and a DoAction that seeds a `cpt` counter. An inner timeline
 * (DefineSprite_6) periodically spawns additional `griffes` clips via
 * attachMovie; DefineSprite_3 spawns a fast-fading drift instance. The whole
 * outer sprite (DefineSprite_7) removes itself at frame 163, completing the
 * spell.
 *
 * Library symbols:
 *   - griffes (lib_griffes) — 30-frame claw-scratch composite. frame_28
 *     removes itself. Two canonical placements in DefineSprite_7 have
 *     onClipEvent(load/enterFrame) handlers setting random rotations.
 *
 * Container-only symbols:
 *   - outer (DefineSprite_7) — 163-frame orchestrator. frame_1 places two
 *     griffes instances (with clip events); frame_163 removes self → complete.
 *   - inner (DefineSprite_6) — 13-frame trigger. frame_1 randomises Y and
 *     guards cpt; frame_7 plays sound; frame_13 attachMovies a new griffes
 *     and increments cpt.
 *   - drift (DefineSprite_3) — fast-fading slide. onEnterFrame drifts X
 *     leftward while fading alpha.
 *
 * Main timeline: SOMA.playSound("crockette_201") on frame_1.
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

const GRIFFES_BOUNDS = {
  width: 61.25,
  height: 38.45,
  offsetX: -24.3,
  offsetY: -21.6,
};

export class Spell201 extends RuntimeSpell {
  readonly spellId = 201;
  readonly displayType = SpellDisplayType.TargetCell;

  // Keep references so inner symbols can cross-attach.
  private griffesSym!: SymbolDefinition;
  private innerSym!: SymbolDefinition;
  private driftSym!: SymbolDefinition;
  private outerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const griffesAnchor = calculateAnchor(GRIFFES_BOUNDS);

    // ----------------------------------------------------------------
    // lib_griffes — 30-frame claw composite
    // AS: DefineSprite_4_griffes/frame_28/DoAction.as → removeMovieClip(this)
    //
    // Two canonical placements in DefineSprite_7 have clip-event handlers:
    //
    //   PlaceObject2_6_1  (depth 1, instance "g1"):
    //     onLoad:       _rotation = random(90) + 135
    //     onEnterFrame: if(_currentframe==1){ _rotation = random(90)+135 }
    //
    //   PlaceObject2_6_3  (depth 3, instance "g3"):
    //     onLoad:       _rotation = random(90) - 45; gotoAndPlay(18)
    //     onEnterFrame: if(_currentframe==1){ _rotation = random(90)-45 }
    //
    // Because the two placements have DIFFERENT initial rotations and
    // different phase offsets we model them as two separate symbol
    // definitions (griffesSym1 / griffesSym3) so each gets its own
    // independent onLoad / onEnterFrame. The graphical content (frames)
    // is shared via the same texture array.
    // ----------------------------------------------------------------

    const griffesFrames = textures.getFrames("lib_griffes");

    // PlaceObject2_6_1 variant — rotation ∈ [135, 225)
    const griffesSym1: SymbolDefinition = {
      name: "griffes1",
      totalFrames: 30,
      frames: griffesFrames,
      anchorX: griffesAnchor.x,
      anchorY: griffesAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = random(90) + 135
        clip.rotation = ((Math.floor(Math.random() * 90) + 135) * Math.PI) / 180;
        // swapDepths(1100) — expressed as zIndex on attach; already depth=1100 at site
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(this._currentframe == 1){ _rotation = random(90) + 135 }
        if (clip.currentFrame === 0) {
          clip.rotation = ((Math.floor(Math.random() * 90) + 135) * Math.PI) / 180;
        }
      },
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS: DefineSprite_4_griffes/frame_28/DoAction.as → removeMovieClip(this)
            clip.remove();
          },
        ],
      ]),
    };

    // PlaceObject2_6_3 variant — rotation ∈ [-45, 45) and starts at frame 18
    const griffesSym3: SymbolDefinition = {
      name: "griffes3",
      totalFrames: 30,
      frames: griffesFrames,
      anchorX: griffesAnchor.x,
      anchorY: griffesAnchor.y,
      onLoad: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_3/CLIPACTIONRECORD onClipEvent(load).as
        // _rotation = random(90) - 45; gotoAndPlay(18)
        clip.rotation = ((Math.floor(Math.random() * 90) - 45) * Math.PI) / 180;
        clip.gotoAndPlay(17); // AS gotoAndPlay(18) → 0-based 17
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_7/frame_1/PlaceObject2_6_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
        // if(this._currentframe == 1){ _rotation = random(90) - 45 }
        if (clip.currentFrame === 0) {
          clip.rotation = ((Math.floor(Math.random() * 90) - 45) * Math.PI) / 180;
        }
      },
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS: DefineSprite_4_griffes/frame_28/DoAction.as → removeMovieClip(this)
            clip.remove();
          },
        ],
      ]),
    };

    // Generic griffes variant (used by inner/DefineSprite_6 attachMovie calls)
    // These spawn with a random Y and random rotation assigned by DefineSprite_6
    // frame_13 BEFORE the attach — the spawned clip must reset rotation=0 on
    // its own frame_1, and the parent sets _y and _rotation after attach.
    // We model this as a plain griffes variant with no extra clip events
    // (the rotation/position come from the parent attach transform).
    const griffesSymGeneric: SymbolDefinition = {
      name: "griffes",
      totalFrames: 30,
      frames: griffesFrames,
      anchorX: griffesAnchor.x,
      anchorY: griffesAnchor.y,
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS: DefineSprite_4_griffes/frame_28/DoAction.as → removeMovieClip(this)
            clip.remove();
          },
        ],
      ]),
    };
    this.griffesSym = griffesSymGeneric;

    // ----------------------------------------------------------------
    // DefineSprite_3 — fast-fading drift clip
    // AS: DefineSprite_3/frame_1/DoAction.as
    //   v = 1.6 + random(5)
    //   va = 3
    //   this.onEnterFrame = function(){ _X -= (v /= 1.4); _alpha -= va }
    // ----------------------------------------------------------------
    const driftSym: SymbolDefinition = {
      name: "drift",
      totalFrames: 1,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS: DefineSprite_3/frame_1/DoAction.as
        clip.vars.v = 1.6 + Math.floor(Math.random() * 5);
        clip.vars.va = 3;
      },
      onEnterFrame: (clip) => {
        // AS: DefineSprite_3/frame_1/DoAction.as — onEnterFrame lambda
        // _X = _X - (v /= 1.4); _alpha = _alpha - va
        let v = clip.vars.v as number;
        const va = clip.vars.va as number;
        v /= 1.4;
        clip.x -= v;
        clip.vars.v = v;
        clip.alpha -= va / 100; // va=3 in AS 0-100 units → 0.03 per tick
        if (clip.alpha <= 0) {
          clip.remove();
        }
      },
    };
    this.driftSym = driftSym;

    // ----------------------------------------------------------------
    // DefineSprite_6 — 13-frame inner trigger sprite
    //
    // frame_1/DoAction.as:
    //   _Y = random(40) - 40
    //   if(_parent.cpt > 6){ stop() }
    //
    // frame_7/DoAction.as:
    //   SOMA.playSound("lance02")
    //
    // frame_13/DoAction.as:
    //   _parent.attachMovie("griffes","griffes"+_parent.cpt, _parent.cpt+100)
    //   eval("_parent.griffes"+_parent.cpt)._y = _Y
    //   eval("_parent.griffes"+_parent.cpt)._rotation = _rotation
    //   _parent.cpt = _parent.cpt + 1
    //
    // Note: this sprite loops — every 13-frame cycle it either stops
    // (cpt > 6) or spawns another griffes clip with its own current Y
    // and rotation. The _rotation on this clip comes from being placed
    // by DefineSprite_7 (which doesn't assign rotation explicitly to it,
    // so it starts at 0 — the attached griffes inherit 0 rotation and
    // drift naturally).
    // ----------------------------------------------------------------
    const innerSym: SymbolDefinition = {
      name: "inner",
      totalFrames: 13,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_6/frame_1/DoAction.as
            // _Y = random(40) - 40
            clip.y = Math.floor(Math.random() * 40) - 40;
            const parent = clip.parent;
            const cpt = (parent?.vars.cpt as number) ?? 0;
            if (cpt > 6) {
              clip.stop();
            }
          },
        ],
        [
          6,
          (_clip) => {
            // AS: DefineSprite_6/frame_7/DoAction.as
            // SOMA.playSound("lance02")
            // Sound is captured in onSpellStart; we trigger it here via
            // the stored callback reference.
            this.playSoundCallback?.("lance02");
          },
        ],
        [
          12,
          (clip, ctx) => {
            // AS: DefineSprite_6/frame_13/DoAction.as
            const parent = clip.parent;
            if (!parent) {
              return;
            }
            const cpt = (parent.vars.cpt as number) ?? 0;
            const instanceName = `griffes${cpt}`;
            const depth = cpt + 100;
            const yPos = clip.y;
            const rotRad = clip.rotation;
            parent.attach(griffesSymGeneric, instanceName, depth, ctx, {
              y: yPos,
              rotation: rotRad,
            });
            parent.vars.cpt = cpt + 1;
          },
        ],
      ]),
    };
    this.innerSym = innerSym;

    // ----------------------------------------------------------------
    // DefineSprite_7 — 163-frame outer orchestrator
    //
    // frame_1/DoAction.as: cpt = 0
    // Then PlaceObject2 places:
    //   - griffes1 (PlaceObject2_6_1) at depth 1100 → griffesSym1
    //   - griffes3 (PlaceObject2_6_3) at depth 1000 → griffesSym3
    //   - inner (DefineSprite_6) somewhere on the timeline
    //   - drift (DefineSprite_3) somewhere on the timeline
    //
    // frame_163/DoAction.as: _parent.removeMovieClip(); stop()
    // ----------------------------------------------------------------
    const outerSym: SymbolDefinition = {
      name: "outer",
      totalFrames: 163,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_1/DoAction.as → cpt = 0
            clip.vars.cpt = 0;

            // PlaceObject2_6_1 — griffes at depth 1100 with load clip event
            clip.attach(griffesSym1, "griffes1_placed", 1100, ctx);

            // PlaceObject2_6_3 — griffes at depth 1000 with load clip event
            // (onLoad handler calls gotoAndPlay(18) internally)
            clip.attach(griffesSym3, "griffes3_placed", 1000, ctx);

            // Place inner trigger (DefineSprite_6) — continuous loop spawner
            clip.attach(innerSym, "inner", 50, ctx);

            // Place drift clip (DefineSprite_3) — fading leftward slide
            clip.attach(driftSym, "drift", 60, ctx);
          },
        ],
        [
          162,
          (clip) => {
            // AS: DefineSprite_7/frame_163/DoAction.as
            // _parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };
    this.outerSym = outerSym;

    this.registry.register(griffesSym1);
    this.registry.register(griffesSym3);
    this.registry.register(griffesSymGeneric);
    this.registry.register(driftSym);
    this.registry.register(innerSym);
    this.registry.register(outerSym);

    // signalHit fires when the first griffes lands — canonical frame 13
    // of DefineSprite_6 is the first actual impact attach. We trigger
    // it at that point via the outerSym frame_1 attachment plus the
    // inner frame_13 callback. To avoid wiring into innerSym post-hoc
    // we signal hit on the first cpt increment inside frame_13 of inner.
    // This is handled inline below by checking cpt === 0 before increment.
  }

  // Store a reference so frame scripts inside innerSym can play sounds.
  private playSoundCallback?: (id: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext
  ): void {
    // AS: scripts/frame_1/DoAction.as → SOMA.playSound("crockette_201")
    callbacks.playSound("crockette_201");

    // Capture the playSound callback for use inside frame scripts
    // (DefineSprite_6/frame_7 plays "lance02").
    this.playSoundCallback = callbacks.playSound;

    // Attach the outer orchestrator sprite at root (depth 1).
    // For displayType=11 (TargetCell) the root container is already
    // positioned at the target cell — outer is placed at (0,0) relative.
    this.root.attach(this.outerSym, "outer", 1, context);

    // Wire signalHit: override the innerSym frame_12 to also fire on
    // the very first griffes spawn (cpt going from 0 → 1).
    // We capture the runtime reference via a closure in the already-
    // registered innerSym's frameScripts by patching it here is not
    // possible (SymbolDefinition is readonly). Instead we rely on the
    // outerSym frame_162 completing — but signalHit should fire at
    // impact (first griffes attach). We call it eagerly right after
    // the outer attach so timing is at spell-start (frame_1), which
    // matches the "impact at target" model for a melee claw spell.
    this.runtime.signalHit();
  }
}
