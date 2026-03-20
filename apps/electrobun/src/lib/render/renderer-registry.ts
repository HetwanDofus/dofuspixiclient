import type { ResizeEvent } from "@/ecs/components";

export class RendererRegistry {
  private renderers = new Map<string, (event: ResizeEvent) => void>();

  register(id: string, onResize: (event: ResizeEvent) => void): void {
    this.renderers.set(id, onResize);
  }

  unregister(id: string): void {
    this.renderers.delete(id);
  }

  notifyResize(event: ResizeEvent): void {
    for (const onResize of this.renderers.values()) {
      onResize(event);
    }
  }

  clear(): void {
    this.renderers.clear();
  }
}
