/**
 * Spell 2043 — (Unknown name, likely a Cra/Iop wind/thunder arrow).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2043/scripts/scripts/
 *
 * displayType=50 (WorldAbsolute). Two parallel authored timelines run
 * simultaneously, both positioning themselves in WORLD coords by reading
 * _parent.cellFrom / _parent.cellTo:
 *
 *   - DefineSprite_29 ("clip1") — the "beam" timeline. Frame_1 positions
 *     itself at cellFrom, rotates toward cellTo, computes `longueur`
 *     (distance), and stores it on vars. Its inner DefineSprite_27
 *     (PlaceObject2_27_1) has onClipEvent(load) that sets _width =
 *     _parent.longueur — i.e. the beam sprite stretches to match the
 *     distance. DefineSprite_27/frame_34 calls stop().
 *
 *   - DefineSprite_37 ("clip2") — the "impact" timeline (28 frames).
 *     frame_1: position at cellTo, copy rotation from _parent.clip1._rotation.
 *     frame_4: SOMA.playSound("vol").
 *     frame_7: this.end() → signalHit.
 *     frame_28: stop(); _parent.removeMovieClip() → complete().
 *
 *   - DefineSprite_18_shoot ("shoot") — 84-frame impact at cellTo.
 *     frame_1: position at cellTo, _rotation=0.
 *     frame_10: SOMA.playSound("explosion").
 *     frame_70: stop().
 *
 * The main timeline has `frame_2/DoAction.as: stop()`, so the outer mc
 * stops on frame 2. No top-level sounds on the main timeline are authored
 * (the manifest shows sounds at frames 3 and 9 but those are in sub-sprites).
 *
 * displayType=50 (WorldAbsolute): container at world (0,0); all children
 * position themselves using absolute world coords from cellFrom/cellTo
 * stored on root.vars by the harness.
 *
 * Library symbols:
 *   - clip1 (DefineSprite_29) — beam from caster to target. frame_1
 *     computes position/rotation/longueur. Contains inner DefineSprite_27
 *     whose onClipEvent(load) resizes the sprite to `longueur`.
 *   - inner27 (DefineSprite_27) — the actual beam sprite inside clip1.
 *     onLoad: _width = _parent.longueur (width scaled to distance).
 *     frame_34: stop().
 *   - clip2 (DefineSprite_37) — impact at target. 28 frames; fires hit at
 *     frame_7; removes parent at frame_28.
 *   - shoot (DefineSprite_18_shoot) — 84-frame explosion at target.
 *     frame_1 resets rotation to 0; frame_10 plays sound; frame_70 stops.
 *
 * Main timeline: frame_2 stop() — no additional sounds or child attaches
 * (sub-sprites are placed via onSpellStart).
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

// Bounds from manifest animations[] entry for "shoot"
const SHOOT_BOUNDS = {
  width: 204.8,
  height: 129.6,
  offsetX: -102.35,
  offsetY: -68.1,
};

export class Spell2043 extends RuntimeSpell {
  readonly spellId = 2043;
  readonly displayType = SpellDisplayType.WorldAbsolute;

  private inner27Sym!: SymbolDefinition;
  private clip1Sym!: SymbolDefinition;
  private clip2Sym!: SymbolDefinition;
  private shootSym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext,
  ): void {
    // ---- inner27 (DefineSprite_27) — beam sprite inside clip1 ------
    // AS: DefineSprite_29/frame_1/PlaceObject2_27_1/CLIPACTIONRECORD onClipEvent(load).as
    //   _width = _parent.longueur;
    // AS: DefineSprite_27/frame_34/DoAction.as
    //   stop();
    //
    // This sprite is the visual beam. Its onLoad stretches it to fill
    // the caster→target distance by setting _width = parent.longueur.
    // In SpellClip terms we approximate _width via scaleX: since the
    // sprite's canonical width is its natural texture width, we compute
    // scaleX = longueur / naturalWidth. We use a sentinel width of 1px
    // if textures are absent (container-only fallback).
    this.inner27Sym = {
      name: "inner27",
      totalFrames: 34,
      frames: [],
      anchorX: 0,
      anchorY: 0.5,
      onLoad: (clip) => {
        // AS DefineSprite_29/frame_1/PlaceObject2_27_1/CLIPACTIONRECORD onClipEvent(load).as
        // _width = _parent.longueur;
        // "longueur" is stored on the parent (clip1) vars by its frame_1 script.
        const parent = clip.parent;
        const longueur = (parent?.vars.longueur as number) ?? 0;
        // We stretch scaleX so that the sprite covers the full beam distance.
        // The sprite's natural width in the authored SWF is 1 unit (it's a
        // 1-px-wide shape that Flash stretches via _width). We honour this
        // by setting scaleX = longueur (1 px × longueur = longueur px wide).
        clip.scaleX = longueur;
      },
      frameScripts: new Map([
        [
          33,
          (clip) => {
            // AS DefineSprite_27/frame_34/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    // ---- clip1 (DefineSprite_29) — caster-to-target beam timeline ----
    // AS: DefineSprite_29/frame_1/DoAction.as
    //   x1 = _parent.cellFrom.x; y1 = _parent.cellFrom.y - 20;
    //   x2 = _parent.cellTo.x;   y2 = _parent.cellTo.y - 20;
    //   _X = x1; _Y = y1;
    //   dx = x2 - x1; dy = y2 - y1;
    //   _rotation = Math.atan2(dy,dx) * 57.29...;
    //   longueur = Math.sqrt(dx*dx + dy*dy);
    //
    // clip1 has a inner DefineSprite_27 placed at PlaceObject2 depth 1
    // inside it. We attach it in frame_1 (frameScripts index 0) AFTER
    // computing longueur so the onLoad handler can read it.
    this.clip1Sym = {
      name: "clip1",
      totalFrames: 34,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_29/frame_1/DoAction.as
            const root = clip.parent;
            const cellFrom = root?.vars.cellFrom as { x: number; y: number } | undefined;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

            const x1 = (cellFrom?.x ?? 0);
            const y1 = (cellFrom?.y ?? 0) - 20;
            const x2 = (cellTo?.x ?? 0);
            const y2 = (cellTo?.y ?? 0) - 20;

            clip.x = x1;
            clip.y = y1;

            const dx = x2 - x1;
            const dy = y2 - y1;

            // AS: _rotation = Math.atan2(dy,dx) * 57.29... (degrees)
            // TS: store in radians directly
            clip.rotation = Math.atan2(dy, dx);

            const longueur = Math.sqrt(dx * dx + dy * dy);
            clip.vars.longueur = longueur;

            // Place the inner beam sprite (DefineSprite_27) at depth 1.
            // onLoad fires immediately inside attach(), reading longueur from
            // clip.vars.longueur set just above.
            clip.attach(this.inner27Sym, "inner27", 1, ctx);
          },
        ],
      ]),
    };

    // ---- clip2 (DefineSprite_37) — impact timeline at target --------
    // AS: DefineSprite_37/frame_1/DoAction.as
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y - 20;
    //   _rotation = _parent.clip1._rotation;  (copy beam angle)
    // AS: DefineSprite_37/frame_4/DoAction.as
    //   SOMA.playSound("vol");
    // AS: DefineSprite_37/frame_7/DoAction.as
    //   this.end(); → signalHit
    // AS: DefineSprite_37/frame_28/DoAction.as
    //   stop(); _parent.removeMovieClip(); → complete()
    this.clip2Sym = {
      name: "clip2",
      totalFrames: 28,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_37/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

            clip.x = cellTo?.x ?? 0;
            clip.y = (cellTo?.y ?? 0) - 20;

            // Copy rotation from clip1 (_parent.clip1._rotation in AS).
            // clip1 stores its rotation in radians in SpellClip.
            const clip1 = root?.children.get("clip1");
            if (clip1) {
              clip.rotation = clip1.rotation;
            }
          },
        ],
        [
          3,
          () => {
            // AS DefineSprite_37/frame_4/DoAction.as: SOMA.playSound("vol")
            // Sound stored via callbacks captured in onSpellStart.
            this.playSoundCallback?.("vol");
          },
        ],
        [
          6,
          () => {
            // AS DefineSprite_37/frame_7/DoAction.as: this.end() → signalHit
            this.runtime.signalHit();
          },
        ],
        [
          27,
          (clip) => {
            // AS DefineSprite_37/frame_28/DoAction.as: stop(); _parent.removeMovieClip()
            clip.stop();
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    // ---- shoot (DefineSprite_18_shoot) — 84-frame explosion ----------
    // animations[] entry "shoot": 84 frames, bounds from SHOOT_BOUNDS.
    // AS: DefineSprite_18_shoot/frame_1/DoAction.as
    //   _X = _parent.cellTo.x; _Y = _parent.cellTo.y; _rotation = 0;
    // AS: DefineSprite_18_shoot/frame_10/DoAction.as
    //   SOMA.playSound("explosion");
    // AS: DefineSprite_18_shoot/frame_70/DoAction.as
    //   stop();
    const shootAnchor = calculateAnchor(SHOOT_BOUNDS);
    this.shootSym = {
      name: "shoot",
      totalFrames: 84,
      frames: textures.getFrames("shoot"),
      anchorX: shootAnchor.x,
      anchorY: shootAnchor.y,
      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_18_shoot/frame_1/DoAction.as
            const root = clip.parent;
            const cellTo = root?.vars.cellTo as { x: number; y: number } | undefined;

            clip.x = cellTo?.x ?? 0;
            clip.y = cellTo?.y ?? 0;
            clip.rotation = 0;
          },
        ],
        [
          9,
          () => {
            // AS DefineSprite_18_shoot/frame_10/DoAction.as: SOMA.playSound("explosion")
            this.playSoundCallback?.("explosion");
          },
        ],
        [
          69,
          (clip) => {
            // AS DefineSprite_18_shoot/frame_70/DoAction.as: stop()
            clip.stop();
          },
        ],
      ]),
    };

    this.registry.register(this.inner27Sym);
    this.registry.register(this.clip1Sym);
    this.registry.register(this.clip2Sym);
    this.registry.register(this.shootSym);
  }

  /** Captured in onSpellStart; used by sub-sprite frame scripts to play sounds. */
  private playSoundCallback?: (soundId: string) => void;

  protected onSpellStart(
    callbacks: SpellCallbacks,
    context: SpellContext,
  ): void {
    // Capture sound callback so frameScripts (which don't receive callbacks)
    // can play sounds at the canonical frames.
    this.playSoundCallback = callbacks.playSound;

    // Main timeline frame_2: stop() — no top-level sounds.
    // Attach the three parallel sub-timelines that make up the spell.
    // clip1 (beam) + clip2 (impact) + shoot (explosion) all start on frame 1
    // of the main timeline (they are PlaceObject2 placements in the canonical SWF).
    this.root.attach(this.clip1Sym, "clip1", 1, context);
    this.root.attach(this.clip2Sym, "clip2", 2, context);
    this.root.attach(this.shootSym, "shoot", 3, context);
  }
}
