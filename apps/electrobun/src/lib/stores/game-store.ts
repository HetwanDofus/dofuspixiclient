/**
 * Generic external store compatible with React's useSyncExternalStore.
 * Provides a simple subscribe/getSnapshot API for reactive state management.
 */
export class ExternalStore<T extends Record<string, unknown>> {
  private state: T;
  private listeners = new Set<() => void>();

  constructor(initialState: T) {
    this.state = { ...initialState };
  }

  getSnapshot = (): T => {
    return this.state;
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setState(partial: Partial<T>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  /** Replace entire state */
  replaceState(next: T): void {
    this.state = { ...next };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
