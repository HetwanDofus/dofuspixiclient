type ProgressListener = (loaded: number, total: number, label: string) => void;

/**
 * Centralized load progress tracking.
 * Components report progress via `report()`, UI subscribes via `onProgress()`.
 */
class LoadProgressEmitter {
  private listeners = new Set<ProgressListener>();
  private progress = new Map<string, { loaded: number; total: number }>();

  onProgress(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  report(label: string, loaded: number, total: number): void {
    this.progress.set(label, { loaded, total });
    for (const fn of this.listeners) fn(loaded, total, label);
  }

  getOverallProgress(): { loaded: number; total: number } {
    let loaded = 0;
    let total = 0;
    for (const p of this.progress.values()) {
      loaded += p.loaded;
      total += p.total;
    }
    return { loaded, total };
  }

  reset(): void {
    this.progress.clear();
  }
}

let instance: LoadProgressEmitter | null = null;

export function getLoadProgress(): LoadProgressEmitter {
  if (!instance) instance = new LoadProgressEmitter();
  return instance;
}
