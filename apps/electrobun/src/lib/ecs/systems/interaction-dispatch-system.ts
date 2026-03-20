import { System, system } from "@lastolivegames/becsy";

import { HoverState, Interactive } from "@/ecs/components";

interface HoverInput {
  type: "hover";
  pickableId: number; // -1 means nothing hovered
}

interface ClickInput {
  type: "click";
  pickableId: number;
}

type InteractionInput = HoverInput | ClickInput;

const pendingEvents: InteractionInput[] = [];

export function pushInteractionEvent(event: InteractionInput): void {
  pendingEvents.push(event);
}

@system
export class InteractionDispatchSystem extends System {
  private interactives = this.query(
    (q) => q.current.with(Interactive, HoverState).write,
  );

  execute(): void {
    if (pendingEvents.length === 0) return;
    const events = pendingEvents.splice(0, pendingEvents.length);

    for (const event of events) {
      if (event.type === "hover") {
        this.processHover(event.pickableId);
      } else if (event.type === "click") {
        this.processClick(event.pickableId);
      }
    }
  }

  private processHover(pickableId: number): void {
    for (const entity of this.interactives.current) {
      const interactive = entity.read(Interactive);
      const hover = entity.write(HoverState);

      if (interactive.pickableId === pickableId && pickableId >= 0) {
        if (!hover.hovered) {
          hover.hovered = true;
          interactive.onHover?.(true);
        }
      } else if (hover.hovered) {
        hover.hovered = false;
        interactive.onHover?.(false);
      }
    }
  }

  private processClick(pickableId: number): void {
    for (const entity of this.interactives.current) {
      const interactive = entity.read(Interactive);
      if (interactive.pickableId === pickableId) {
        interactive.onClick?.();
        break;
      }
    }
  }
}
