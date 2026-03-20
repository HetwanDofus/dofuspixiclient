import { System, system } from "@lastolivegames/becsy";

import { Resizable, type ResizeEvent, ResizeContext } from "@/ecs/components";

@system
export class ResizeSystem extends System {
  private resizeCtx = this.singleton.read(ResizeContext);
  private resizables = this.query((q) => q.current.with(Resizable).read);

  execute(): void {
    const ctx = this.resizeCtx;
    if (!ctx.dirty) return;

    const event: ResizeEvent = {
      zoom: ctx.zoom,
      baseZoom: ctx.baseZoom,
      screenWidth: ctx.screenWidth,
      screenHeight: ctx.screenHeight,
    };

    for (const entity of this.resizables.current) {
      const r = entity.read(Resizable);
      r.onResize?.(event);
    }
  }
}
