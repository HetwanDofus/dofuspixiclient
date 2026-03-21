/**
 * Configurable keybindings system.
 * Actions are mapped to keys that can be rebound at runtime.
 */

export type KeyAction =
  | "toggleStats"
  | "toggleDebug"
  | "toggleGrid"
  | "toggleStressTest"
  | "toggleWorldMap"
  | "escape";

const defaultBindings: Record<KeyAction, string> = {
  toggleStats: "c",
  toggleDebug: "d",
  toggleGrid: "g",
  toggleStressTest: "t",
  toggleWorldMap: "m",
  escape: "escape",
};

type ActionHandler = () => void;

export class Keybindings {
  private bindings: Record<string, string>;
  private handlers = new Map<KeyAction, ActionHandler>();
  private onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  constructor(overrides?: Partial<Record<KeyAction, string>>) {
    this.bindings = { ...defaultBindings, ...overrides };
  }

  /** Register a handler for an action. */
  on(action: KeyAction, handler: ActionHandler): void {
    this.handlers.set(action, handler);
  }

  /** Remove a handler for an action. */
  off(action: KeyAction): void {
    this.handlers.delete(action);
  }

  /** Rebind a key at runtime. */
  rebind(action: KeyAction, key: string): void {
    this.bindings[action] = key;
  }

  /** Get current key for an action. */
  getKey(action: KeyAction): string {
    return this.bindings[action];
  }

  /** Get all current bindings. */
  getAll(): Readonly<Record<string, string>> {
    return { ...this.bindings };
  }

  /** Start listening to keyboard events. */
  attach(): void {
    if (this.onKeyDown) return;
    this.onKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const key = e.key.toLowerCase();
      for (const [action, boundKey] of Object.entries(this.bindings)) {
        if (key === boundKey.toLowerCase()) {
          const handler = this.handlers.get(action as KeyAction);
          if (handler) {
            e.preventDefault();
            handler();
          }
        }
      }
    };
    window.addEventListener("keydown", this.onKeyDown);
  }

  /** Stop listening to keyboard events. */
  detach(): void {
    if (this.onKeyDown) {
      window.removeEventListener("keydown", this.onKeyDown);
      this.onKeyDown = null;
    }
  }

  destroy(): void {
    this.detach();
    this.handlers.clear();
  }
}
