/**
 * Keybindings — modeled on Dofus 1.29 `dofus.managers.KeyManager`.
 *
 * Action names mirror the `sShortcut` vocabulary used by the legacy client
 * (extracted from `assets/sources/client-code/dofus/graphics/gapi/ui/Banner.as`
 * and `dofus/managers/KeyManager.as`). Default key bindings approximate
 * the legacy layout; the real engine persisted user overrides through
 * `SharedObject` — we store overrides in localStorage instead.
 */

/**
 * Canonical Dofus shortcut names. Subset we actually use in the re-write;
 * others (chat history, whisper navigation, conquest, etc.) can be added
 * as they get wired up.
 */
export type Shortcut =
  // ── Flow control ─────────────────────────────────────────
  | "ESCAPE"
  | "ACCEPT_CURRENT_DIALOG"
  | "NEXTTURN"
  // ── Main banner panels ───────────────────────────────────
  | "CHARAC"
  | "SPELLS"
  | "INVENTORY"
  | "QUESTS"
  | "MAP"
  | "FRIENDS"
  | "GUILD"
  | "MOUNT"
  | "JOBS"
  // ── Hotbar ───────────────────────────────────────────────
  | "SWAP"
  | HotbarShortcut
  // ── Debug tooling (not in legacy) ────────────────────────
  | "DEBUG_TOGGLE"
  | "DEBUG_GRID"
  | "DEBUG_TRANSPARENCY";

/**
 * `SH1`..`SH14` — one per cell of the shortcut bar. The legacy client
 * names them the same way (`MouseShortcuts.onShortcut` switches on
 * `"SH" + n`); `SH0` is the melee-attack container, which this hotbar
 * does not have yet.
 */
export type HotbarShortcut =
  `SH${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14}`;

/** The 14 hotbar shortcuts in cell order, for registration loops. */
export const HOTBAR_SHORTCUTS: readonly HotbarShortcut[] = [
  "SH1",
  "SH2",
  "SH3",
  "SH4",
  "SH5",
  "SH6",
  "SH7",
  "SH8",
  "SH9",
  "SH10",
  "SH11",
  "SH12",
  "SH13",
  "SH14",
];

/** Modifier flags, matching KeyManager.as _bCtrlDown / _bShiftDown. */
export interface ChordKey {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
}

/**
 * Default bindings — picked to match documented Dofus 1.29 conventions where
 * the legacy `SHORTCUTS_DEFAULT_SET` SharedObject specified them. See
 * `dofus/utils/DofusTranslator.as:getKeyboardShortcuts()` for the indirection.
 */
const DEFAULT_BINDINGS: Record<Shortcut, ChordKey> = {
  ESCAPE: { key: "escape" },
  ACCEPT_CURRENT_DIALOG: { key: "enter" },
  NEXTTURN: { key: "f1" },

  CHARAC: { key: "c" },
  SPELLS: { key: "s" },
  INVENTORY: { key: "i" },
  QUESTS: { key: "q" },
  MAP: { key: "m" },
  FRIENDS: { key: "f" },
  GUILD: { key: "g" },
  MOUNT: { key: "u" },
  JOBS: { key: "j" },

  // Read out of the retail lang bundle rather than guessed:
  // `assets/dist/langs/fr/shortcuts.json`, table `SSK`, default set 1
  // (`Clavier français - France`). Top row 1..7 are the bare digits,
  // bottom row A..G are the same digits with Ctrl, and SWAP — the
  // Spells/Items toggle — is `<` (keycode 226).
  SWAP: { key: "<" },
  SH1: { key: "1" },
  SH2: { key: "2" },
  SH3: { key: "3" },
  SH4: { key: "4" },
  SH5: { key: "5" },
  SH6: { key: "6" },
  SH7: { key: "7" },
  SH8: { key: "1", ctrl: true },
  SH9: { key: "2", ctrl: true },
  SH10: { key: "3", ctrl: true },
  SH11: { key: "4", ctrl: true },
  SH12: { key: "5", ctrl: true },
  SH13: { key: "6", ctrl: true },
  SH14: { key: "7", ctrl: true },

  DEBUG_TOGGLE: { key: "d" },
  DEBUG_GRID: { key: "g", shift: true },
  DEBUG_TRANSPARENCY: { key: "v" },
};

const STORAGE_KEY = "dofus.keybindings.v1";

type ShortcutHandler = () => void;

function chordKey(e: KeyboardEvent): string {
  return e.key.toLowerCase();
}

function chordsEqual(a: ChordKey, b: ChordKey): boolean {
  return (
    a.key.toLowerCase() === b.key.toLowerCase() &&
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift
  );
}

/**
 * Load overrides persisted in localStorage (mirrors KeyManager's SharedObject).
 * Never throws — malformed data resets to defaults.
 */
function loadOverrides(): Partial<Record<Shortcut, ChordKey>> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);

    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<Record<Shortcut, ChordKey>>;
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function saveOverrides(overrides: Partial<Record<Shortcut, ChordKey>>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // ignore — in-memory binding still works.
  }
}

/**
 * Keyboard shortcut dispatcher. Attach once, register handlers per shortcut,
 * rebind at runtime. Mirrors the `dispatchShortcut(sShortcut)` API on the
 * legacy KeyManager.
 */
export class Keybindings {
  private bindings: Record<Shortcut, ChordKey>;
  private readonly handlers = new Map<Shortcut, ShortcutHandler>();
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(overrides?: Partial<Record<Shortcut, ChordKey>>) {
    const persisted = loadOverrides();
    this.bindings = {
      ...DEFAULT_BINDINGS,
      ...persisted,
      ...(overrides ?? {}),
    };
  }

  /** Register a handler for a shortcut. Replaces any previous handler. */
  on(shortcut: Shortcut, handler: ShortcutHandler): void {
    this.handlers.set(shortcut, handler);
  }

  /** Drop a handler. */
  off(shortcut: Shortcut): void {
    this.handlers.delete(shortcut);
  }

  /** Rebind and persist. */
  rebind(shortcut: Shortcut, chord: ChordKey): void {
    this.bindings[shortcut] = chord;
    const overrides = loadOverrides();
    overrides[shortcut] = chord;
    saveOverrides(overrides);
  }

  /** Current chord for a shortcut. */
  getChord(shortcut: Shortcut): ChordKey {
    return this.bindings[shortcut];
  }

  /** All current bindings — read-only snapshot. */
  getAll(): Readonly<Record<Shortcut, ChordKey>> {
    return { ...this.bindings };
  }

  /** Reset to defaults, clearing persisted overrides. */
  resetDefaults(): void {
    this.bindings = { ...DEFAULT_BINDINGS };
    saveOverrides({});
  }

  /**
   * Start listening to keyboard events. KeyManager.as skips dispatch when
   * input controls are focused; we do the same.
   */
  attach(): void {
    if (this.onKeyDown) {
      return;
    }

    this.onKeyDown = (e: KeyboardEvent) => {
      if (this.isTypingInInput(e.target)) {
        return;
      }

      const chord: ChordKey = {
        key: chordKey(e),
        ctrl: e.ctrlKey || e.metaKey,
        shift: e.shiftKey,
      };

      for (const [shortcut, bound] of Object.entries(this.bindings)) {
        if (!chordsEqual(chord, bound)) {
          continue;
        }

        const handler = this.handlers.get(shortcut as Shortcut);

        if (!handler) {
          continue;
        }

        e.preventDefault();
        handler();
        return;
      }
    };

    window.addEventListener("keydown", this.onKeyDown);
  }

  /** Stop listening and drop the handler. */
  destroy(): void {
    if (!this.onKeyDown) {
      return;
    }

    window.removeEventListener("keydown", this.onKeyDown);
    this.onKeyDown = null;
    this.handlers.clear();
  }

  private isTypingInInput(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    const tag = target.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      target.isContentEditable
    );
  }
}
