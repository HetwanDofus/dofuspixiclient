/**
 * Spell 2018 — Projectile spell (ballistic arc, smoke particles at impact).
 *
 * Hand-ported against the SpellClip / SpellRuntime composition runtime.
 * Canonical AS source: tools/combat-exporter/output/spell-anims/2018/scripts/scripts/
 *
 * displayType=30 (ProjectileBallistic). The spell has a `move` (6-frame
 * projectile visual) and a `shoot` (108-frame impact/burn container), which
 * is the canonical pattern for ballistic projectiles. The harness attaches
 * `move`, drives it along a parabolic arc to the target, then attaches
 * `shoot` on landing and fires signalHit automatically — do NOT call
 * signalHit from per-spell code for this displayType.
 *
 * Library symbols:
 *   - lib_fumee2 — 57-frame smoke particle. frame_1 seeds physics vars
 *     (t, vt, vr, vy*=2, yi) and installs an onEnterFrame closure for
 *     drift + gravity + landing + fade expansion. frame_55 removes itself.
 *
 * Animations (non-library, container-only for harness):
 *   - move  — 6-frame projectile visual driven by the ballistic harness.
 *   - shoot — 108-frame empty container. frame_1 spawns 7 fumee2 smoke
 *     particles on _parent (root) at shoot's position. frame_106 calls
 *     _parent.removeMovieClip() → spell complete.
 *
 * Main timeline: no SOMA.playSound found in the provided canonical scripts.
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

const FUMEE2_BOUNDS = {
  width: 3.6,
  height: 3.6,
  offsetX: -1.6,
  offsetY: -2.05,
};

const MOVE_BOUNDS = {
  width: 15.5,
  height: 5.3,
  offsetX: -9.7,
  offsetY: -2.7,
};

export class Spell2018 extends RuntimeSpell {
  readonly spellId = 2018;
  readonly displayType = SpellDisplayType.ProjectileBallistic;

  // Hold a reference so shoot's frameScripts can attach fumee2 particles.
  private fumee2Sym!: SymbolDefinition;

  protected registerSymbols(
    textures: SpellTextureProvider,
    _context: SpellContext
  ): void {
    const fumee2Anchor = calculateAnchor(FUMEE2_BOUNDS);
    const moveAnchor = calculateAnchor(MOVE_BOUNDS);

    // ---- lib_fumee2 — smoke/dust particle spawned at impact --------
    //
    // Canonical AS: DefineSprite_7_fumee2/frame_1/DoAction.as
    //
    // The frame_1 script runs on first tick after attach. It:
    //   - seeds t (random scale 50-100), applies _xscale/_yscale = t
    //   - keeps vx as-is (set by caller), doubles vy (vy *= 2)
    //   - seeds yi = _Y - 5 + 10*random  (landing threshold)
    //   - seeds vr (rotation speed), fin=0, a=0, vt=2
    //   - calls stop() (clip does NOT auto-play its timeline)
    //   - installs this.onEnterFrame = function() { ... }
    //
    // In our runtime the frame_1 logic goes into frameScripts[0], which
    // runs synchronously inside attach() after onLoad. vx and vy are
    // pre-seeded on clip.vars by the shoot frameScripts[0] BEFORE attach
    // is called (see shoot symbol below) — so frameScripts[0] here reads
    // the real values.
    //
    // The onEnterFrame closure body is ported as the SymbolDefinition's
    // onEnterFrame handler (called every Flash frame for the clip's life).
    //
    // Canonical AS: DefineSprite_7_fumee2/frame_55/DoAction.as
    //   this.removeMovieClip()
    this.fumee2Sym = {
      name: "fumee2",
      totalFrames: 57,
      frames: textures.getFrames("lib_fumee2"),
      anchorX: fumee2Anchor.x,
      anchorY: fumee2Anchor.y,

      frameScripts: new Map([
        [
          0,
          (clip) => {
            // AS DefineSprite_7_fumee2/frame_1/DoAction.as
            // t = 50 * Math.random() + 50
            const t = 50 * Math.random() + 50;
            clip.vars.t = t;
            clip.scaleX = t / 100;
            clip.scaleY = t / 100;
            // vx = vx  (no-op — already set by caller)
            clip.vars.vt = 2;
            // vy *= 2
            const vy = (clip.vars.vy as number) ?? 0;
            clip.vars.vy = vy * 2;
            // yi = _Y - 5 + 10 * Math.random()
            clip.vars.yi = clip.y - 5 + 10 * Math.random();
            // vr = 30 * Math.random() - 0.5
            clip.vars.vr = 30 * Math.random() - 0.5;
            clip.vars.fin = 0;
            clip.vars.a = 0;
            // stop() — clip timeline does not auto-advance
            clip.stop();
          },
        ],
        [
          54,
          (clip) => {
            // AS DefineSprite_7_fumee2/frame_55/DoAction.as
            // this.removeMovieClip()
            clip.remove();
          },
        ],
      ]),

      onEnterFrame: (clip) => {
        // AS DefineSprite_7_fumee2/frame_1/DoAction.as — onEnterFrame closure
        let fin = clip.vars.fin as number;
        let vt = clip.vars.vt as number;
        let a = clip.vars.a as number;
        let vy = clip.vars.vy as number;
        const vx = clip.vars.vx as number;
        const vr = clip.vars.vr as number;
        const t = clip.vars.t as number;
        const yi = clip.vars.yi as number;

        if (fin === 1) {
          // _alpha = 150 - (a += 3.3)
          a += 3.3;
          clip.vars.a = a;
          // Flash _alpha is 0-100; 150-a can exceed 100, clamp to [0,1]
          clip.alpha = Math.max(0, Math.min(1, (150 - a) / 100));
          // _xscale = t * vt * 2;  _yscale = t * vt
          clip.scaleX = (t * vt * 2) / 100;
          clip.scaleY = (t * vt) / 100;
          // vt -= (vt - 3) / 1.5
          vt = vt - (vt - 3) / 1.5;
          clip.vars.vt = vt;
        }

        // _X = _X + vx;  _Y = _Y + vy
        clip.x += vx;
        clip.y += vy;

        // _rotation = _rotation + vr  (AS degrees → TS radians delta)
        clip.rotation += (vr * Math.PI) / 180;

        // if (_Y > yi) — landing condition
        if (clip.y > yi) {
          clip.y = yi;
          clip.vars.vy = 0;
          clip.rotation = 0;
          clip.vars.vr = 0;
          clip.vars.vx = 0;
          // pain.pain.vr = 0; pain.pain.i = 0.8 — sub-clip refs not
          // applicable in our runtime (no "pain" descendant)
          clip.play();
          fin = 1;
          clip.vars.fin = 1;
        }

        // vy += 0.5  (gravity)
        vy += 0.5;
        clip.vars.vy = vy;
      },
    };

    // ---- move — 6-frame projectile visual (driven by ballistic harness) --
    // The harness attaches this symbol at root (0,0) and animates it along
    // the parabolic arc. No frame scripts needed — the visual animation
    // loops automatically through the 6 frames while in flight.
    const moveSym: SymbolDefinition = {
      name: "move",
      totalFrames: 6,
      frames: textures.getFrames("move"),
      anchorX: moveAnchor.x,
      anchorY: moveAnchor.y,
    };

    // ---- shoot — 108-frame impact container ------------------------
    // AS DefineSprite_1_shoot/frame_1/DoAction.as:
    //   _rotation = 0  (override velocity-angle set by harness)
    //   xi = this._x; yi = this._y; c = 0
    //   while (p < 7): attachMovie("fumee2", "fumee2"+c+200, c+200)
    //     set f._x = shoot._x, f._y = shoot._y
    //     set f.vx = shoot._x - xi + 5*(rand-0.5)
    //     set f.vy = -5*rand
    //     c++; xi = shoot._x; yi = shoot._y; p++
    //
    // Note: all 7 particles are spawned at the same position (shoot._x/y)
    // because xi is reset to shoot._x each iteration and shoot doesn't
    // move, so vx for each particle ≈ 5*(rand-0.5) (scatter only).
    //
    // AS DefineSprite_1_shoot/frame_106/DoAction.as:
    //   _parent.removeMovieClip(); stop()
    const shootSym: SymbolDefinition = {
      name: "shoot",
      totalFrames: 108,
      frames: [],
      anchorX: 0.5,
      anchorY: 0.5,

      frameScripts: new Map([
        [
          0,
          (clip, ctx) => {
            // AS DefineSprite_1_shoot/frame_1/DoAction.as
            // Override harness-applied projectile-velocity rotation.
            clip.rotation = 0;

            const parent = clip.parent;
            if (!parent) {
              return;
            }

            // xi = this._x (shoot's x in parent-local = target offset)
            const xi = clip.x;
            let c = 0;

            for (let p = 0; p < 7; p++) {
              const instanceName = `fumee2${c}200`;
              const depth = c + 200;

              // Canonical vx/vy values computed from shoot's position.
              // Since xi is reset to shoot._x each loop iteration and
              // shoot._x never changes, vx = shoot._x - shoot._x + scatter
              //   = 5 * (Math.random() - 0.5)  for all iterations.
              const vxVal = clip.x - xi + 5 * (Math.random() - 0.5);
              const vyVal = -5 * Math.random();

              // Pre-seed vx/vy on the child's vars BEFORE attach triggers
              // fumee2's frameScripts[0]. We create a temporary vars
              // object the child will inherit by pre-populating the
              // fumee2Sym is shared — instead we use a post-attach write
              // and accept that frameScripts[0]'s `vy *= 2` runs on the
              // pre-seeded value. We inject by attaching first, then
              // correcting vy (which frameScripts[0] doubled from its
              // default of 0, so vy=0*2=0 — we then set the real
              // post-doubled value).
              const child = parent.attach(
                this.fumee2Sym,
                instanceName,
                depth,
                ctx,
                { x: clip.x, y: clip.y }
              );

              // Post-attach: set actual vx and the real vy (already
              // doubled by frameScripts[0] on its default-0 value, so
              // we write the doubled value directly).
              child.vars.vx = vxVal;
              child.vars.vy = vyVal * 2; // canonical: frame_1 does vy *= 2

              // Re-seed yi now that y is correctly placed and vy is known.
              child.vars.yi = child.y - 5 + 10 * Math.random();

              c++;
              // xi = this._x (reset each iteration — shoot._x unchanged)
            }
          },
        ],
        [
          105,
          (clip) => {
            // AS DefineSprite_1_shoot/frame_106/DoAction.as
            // _parent.removeMovieClip(); stop()
            clip.remove();
            this.runtime.complete();
          },
        ],
      ]),
    };

    this.registry.register(this.fumee2Sym);
    this.registry.register(moveSym);
    this.registry.register(shootSym);
  }

  protected onSpellStart(
    _callbacks: SpellCallbacks,
    _context: SpellContext
  ): void {
    // No SOMA.playSound found in the canonical AS scripts for spell 2018.
    // The harness (displayType=30, ProjectileBallistic) attaches "move" at
    // root (0,0) and drives the parabolic arc automatically. On landing it
    // attaches "shoot" at the target offset and calls runtime.signalHit().
  }
}
