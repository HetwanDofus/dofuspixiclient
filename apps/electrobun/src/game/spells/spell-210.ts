/**
 * Spell 210 — Griffes de Craqueleur (Craqueleur claw attack).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/210/scripts/scripts/
 *
 * displayType=11 (TargetCell). The spell is an impact at the target cell —
 * no projectile, no caster reference, no dual-anchor. A single outer
 * container (DefineSprite_7, 163 frames) plays at the target cell,
 * spawning up to 7 `griffes` claw-strike clips at random Y offsets and
 * rotations via an inner launcher sprite (DefineSprite_6, 13-frame loop).
 * The two griffes instances pre-placed by PlaceObject2 on DefineSprite_7
 * carry onClipEvent(load/enterFrame) handlers that randomise their
 * rotation on loop.
 *
 * Library symbols:
 *   - griffes (lib_griffes) — 30-frame claw-strike animation.
 *       frame_28 (index 27): removeMovieClip(this); stop() — self-removes.
 *
 * Symbol tree:
 *   root (TargetCell)
 *     └── outer (DefineSprite_7, 163 frames)
 *           ├── griffes1 (PlaceObject2_6_1 — pre-placed griffes instance)
 *           │     onLoad:       random rotation [135, 225) deg, swapDepths 1100
 *           │     onEnterFrame: re-randomise rotation on frame 1
 *           ├── griffes3 (PlaceObject2_6_3 — pre-placed griffes instance)
 *           │     onLoad:       random rotation [-45, 45) deg, gotoAndPlay(18), swapDepths 1000
 *           │     onEnterFrame: re-randomise rotation on frame 1
 *           ├── launcher (DefineSprite_6, loops every 13 frames)
 *           │     frame_1 (0):  _Y = random(40)-40; stop if cpt>6
 *           │     frame_7 (6):  SOMA.playSound("lance02")
 *           │     frame_13(12): attachMovie("griffes","griffes"+cpt,cpt+100);
 *           │                   copy _y/_rotation; cpt++
 *           └── outer frame_163 (162): _parent.removeMovieClip(); stop() → complete()
 *
 * Main timeline (frame_1/DoAction.as): SOMA.playSound("crockette_201").
 * (DefineSprite_3 references a separate dynamic sprite not in librarySymbols —
 *  its v/va sliding logic lives inside its own frame_1 DoAction. The manifest
 *  has no placement metadata for it so it is not attached here.)
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

export class Spell210 extends RuntimeSpell {
  readonly spellId = 210;
  readonly displayType = SpellDisplayType.TargetCell;

  // Held so onSpellStart can attach outer and launcher can attach griffes
  private griffesSym!: SymbolDefinition;
  private launcherSym!: SymbolDefinition;
  private griffe1Sym!: SymbolDefinition;
  private griffe3Sym!: SymbolDefinition;
  private outerSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    const griffesAnchor = calculateAnchor(GRIFFES_BOUNDS);

    // ---- griffes — 30-frame claw-strike animation ---------------
    // AS: DefineSprite_4_griffes / frame_28 / DoAction.as
    //   removeMovieClip(this); stop();
    this.griffesSym = {
      name: "griffes",
      totalFrames: 30,
      frames: textures.getFrames("lib_griffes"),
      anchorX: griffesAnchor.x,
      anchorY: griffesAnchor.y,
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS: DefineSprite_4_griffes/frame_28/DoAction.as
            // removeMovieClip(this); stop();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- griffe1 — PlaceObject2_6_1 pre-placed griffes instance --
    // onClipEvent(load):   _rotation = random(90) + 135; swapDepths(1100)
    // onClipEvent(enterFrame): if (_currentframe == 1) { _rotation = random(90)+135 }
    // Mirrors the behaviours described in:
    //   DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_7/frame_1/PlaceObject2_6_1/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.griffe1Sym = {
      name: "griffe1",
      totalFrames: 30,
      frames: textures.getFrames("lib_griffes"),
      anchorX: griffesAnchor.x,
      anchorY: griffesAnchor.y,
      onLoad: (clip) => {
        // AS: _rotation = random(90) + 135;
        // (swapDepths is display-list ordering — depth is handled by attach() zIndex)
        const deg = Math.floor(Math.random() * 90) + 135;
        clip.rotation = (deg * Math.PI) / 180;
      },
      onEnterFrame: (clip) => {
        // AS: if (this._currentframe == 1) { _rotation = random(90) + 135; }
        if (clip.currentFrame === 0) {
          const deg = Math.floor(Math.random() * 90) + 135;
          clip.rotation = (deg * Math.PI) / 180;
        }
      },
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS: (griffes symbol frame_28) removeMovieClip(this); stop();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- griffe3 — PlaceObject2_6_3 pre-placed griffes instance --
    // onClipEvent(load):   _rotation = random(90) - 45; gotoAndPlay(18); swapDepths(1000)
    // onClipEvent(enterFrame): if (_currentframe == 1) { _rotation = random(90)-45 }
    // Mirrors:
    //   DefineSprite_7/frame_1/PlaceObject2_6_3/CLIPACTIONRECORD onClipEvent(load).as
    //   DefineSprite_7/frame_1/PlaceObject2_6_3/CLIPACTIONRECORD onClipEvent(enterFrame).as
    this.griffe3Sym = {
      name: "griffe3",
      totalFrames: 30,
      frames: textures.getFrames("lib_griffes"),
      anchorX: griffesAnchor.x,
      anchorY: griffesAnchor.y,
      onLoad: (clip) => {
        // AS: _rotation = random(90) - 45; gotoAndPlay(18);
        const deg = Math.floor(Math.random() * 90) - 45;
        clip.rotation = (deg * Math.PI) / 180;
        // gotoAndPlay(18) in AS = frame index 17 (0-based)
        clip.gotoAndPlay(17);
      },
      onEnterFrame: (clip) => {
        // AS: if (this._currentframe == 1) { _rotation = random(90) - 45; }
        if (clip.currentFrame === 0) {
          const deg = Math.floor(Math.random() * 90) - 45;
          clip.rotation = (deg * Math.PI) / 180;
        }
      },
      frameScripts: new Map([
        [
          27,
          (clip) => {
            // AS: (griffes symbol frame_28) removeMovieClip(this); stop();
            clip.remove();
          },
        ],
      ]),
    };

    // ---- launcher — DefineSprite_6 (13-frame loop) ---------------
    // frame_1  (0): _Y = random(40) - 40; if (cpt > 6) stop()
    // frame_7  (6): SOMA.playSound("lance02")
    // frame_13 (12): attachMovie("griffes","griffes"+cpt,cpt+100);
    //               copy _y/_rotation; cpt++
    // Container-only (no authored frame content — the griffes children supply visuals).
    this.launcherSym = {
      name: "launcher",
      totalFrames: 13,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS: DefineSprite_6/frame_1/DoAction.as
            // _Y = random(40) - 40;
            // if (_parent.cpt > 6) { stop(); }
            const yVal = Math.floor(Math.random() * 40) - 40;
            clip.y = yVal;
            const parent = clip.parent;
            const cpt = (parent?.vars.cpt as number) ?? 0;
            if (cpt > 6) {
              clip.stop();
            }
          },
        ],
        [
          6,
          (_clip, ctx) => {
            // AS: DefineSprite_6/frame_7/DoAction.as
            // SOMA.playSound("lance02");
            // We stored the callbacks reference in onSpellStart.
            (ctx as unknown as { _soundCb?: (id: string) => void })._soundCb?.("lance02");
          },
        ],
        [
          12,
          (clip, ctx) => {
            // AS: DefineSprite_6/frame_13/DoAction.as
            // _parent.attachMovie("griffes","griffes"+_parent.cpt,_parent.cpt+100);
            // eval("_parent.griffes"+_parent.cpt)._y = _Y;
            // eval("_parent.griffes"+_parent.cpt)._rotation = _rotation;
            // _parent.cpt = _parent.cpt + 1;
            const parent = clip.parent;
            if (!parent) {
              return;
            }
            const cpt = (parent.vars.cpt as number) ?? 0;
            const instanceName = `griffes${cpt}`;
            const depth = cpt + 100;
            const spawnedClip = parent.attach(
              this.griffesSym,
              instanceName,
              depth,
              ctx,
            );
            // Copy launcher's _y and _rotation to the new griffes clip
            spawnedClip.y = clip.y;
            spawnedClip.rotation = clip.rotation;
            parent.vars.cpt = cpt + 1;
          },
        ],
      ]),
    };

    // ---- outer — DefineSprite_7 (163 frames) ---------------------
    // frame_1  (0): cpt = 0; places griffe1 (depth 1100) + griffe3 (depth 1000)
    //               + launcher (depth 1)
    // frame_163(162): _parent.removeMovieClip(); stop() → complete()
    this.outerSym = {
      name: "outer",
      totalFrames: 163,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS: DefineSprite_7/frame_1/DoAction.as — cpt = 0;
            clip.vars.cpt = 0;
            // PlaceObject2_6_1 — first pre-placed griffes with onLoad/onEnterFrame
            clip.attach(this.griffe1Sym, "griffes_p1", 1100, ctx);
            // PlaceObject2_6_3 — second pre-placed griffes with onLoad/onEnterFrame
            clip.attach(this.griffe3Sym, "griffes_p3", 1000, ctx);
            // Launcher clip at depth 1
            clip.attach(this.launcherSym, "launcher", 1, ctx);
          },
        ],
        [
          162,
          (clip) => {
            // AS: DefineSprite_7/frame_163/DoAction.as
            // _parent.removeMovieClip(); stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.griffesSym);
    this.registry.register(this.griffe1Sym);
    this.registry.register(this.griffe3Sym);
    this.registry.register(this.launcherSym);
    this.registry.register(this.outerSym);
  }

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // AS: scripts/frame_1/DoAction.as — SOMA.playSound("crockette_201");
    callbacks.playSound("crockette_201");

    // Stash the sound callback on the context object so launcher's frame_7
    // can call it without holding a closure over callbacks directly.
    // (We attach it as a side-channel on context via cast — the runtime
    //  passes the same ctx reference to every frameScript/onEnterFrame.)
    (context as unknown as { _soundCb?: (id: string) => void })._soundCb =
      callbacks.playSound;

    // signalHit at the first attach wave — canonical impact is frame_13 of
    // the launcher (first griffes spawn). We fire it once here at spell
    // start consistent with TargetCell impact spells.
    this.runtime.signalHit();

    // Attach the outer container (DefineSprite_7) at the root.
    this.root.attach(this.outerSym, "outer", 1, context);
  }
}
