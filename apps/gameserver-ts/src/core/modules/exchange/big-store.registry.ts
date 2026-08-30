import type { Serializable } from "@shared/handoff/handoff.coordinator";
import { Injectable, Logger } from "@nestjs/common";
import { HandoffPart } from "@shared/handoff/handoff-part.decorator";

/** What one session is currently looking at inside an auction house. */
export interface BigStoreView {
  sessionId: string;
  hdvId: number;
  /** The item type whose template list this session last asked for. */
  typeId: number | null;
  /** The template whose price grid is on screen, if any. */
  templateId: number | null;
}

interface SerializedViews {
  views: BigStoreView[];
}

/**
 * Who is watching which shelf.
 *
 * An auction house is the first exchange in this server whose contents
 * change because of **somebody else**: a lot bought or listed by one
 * player has to reach every other player whose price grid is showing it,
 * and only those. Without this, the choice is between broadcasting to
 * everyone in the hall (frames for grids nobody is looking at) and
 * sending nothing (a "Acheter" button on a lot that sold ten seconds
 * ago).
 *
 * Serialised across a blue/green restart for the same reason
 * `ExchangeRegistryService` is: the exchange session itself survives, so
 * a view that did not would leave a live window quietly deaf to updates.
 */
@Injectable()
@HandoffPart()
export class BigStoreRegistry implements Serializable<SerializedViews> {
  readonly name = "bigstore.views";

  private readonly logger = new Logger(BigStoreRegistry.name);
  private readonly bySession = new Map<string, BigStoreView>();

  enter(sessionId: string, hdvId: number): void {
    this.bySession.set(sessionId, {
      sessionId,
      hdvId,
      typeId: null,
      templateId: null,
    });
  }

  leave(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  get(sessionId: string): BigStoreView | undefined {
    return this.bySession.get(sessionId);
  }

  /** `EHT` — this session moved to another category. */
  browseType(sessionId: string, typeId: number): void {
    const view = this.bySession.get(sessionId);

    if (view) {
      view.typeId = typeId;
      view.templateId = null;
    }
  }

  /** `EHl` — this session opened one template's price grid. */
  browseTemplate(sessionId: string, templateId: number): void {
    const view = this.bySession.get(sessionId);

    if (view) {
      view.templateId = templateId;
    }
  }

  /** The sessions whose price grid currently shows `templateId`. */
  watchingTemplate(hdvId: number, templateId: number): string[] {
    return this.matching(
      (view) => view.hdvId === hdvId && view.templateId === templateId
    );
  }

  /** The sessions whose object list currently shows `typeId`. */
  watchingType(hdvId: number, typeId: number): string[] {
    return this.matching(
      (view) => view.hdvId === hdvId && view.typeId === typeId
    );
  }

  serialize(): SerializedViews {
    return { views: [...this.bySession.values()] };
  }

  restore(state: SerializedViews): void {
    this.bySession.clear();

    for (const view of state.views ?? []) {
      this.bySession.set(view.sessionId, view);
    }

    this.logger.log(`restored ${this.bySession.size} auction house view(s)`);
  }

  private matching(predicate: (view: BigStoreView) => boolean): string[] {
    const out: string[] = [];

    for (const view of this.bySession.values()) {
      if (predicate(view)) {
        out.push(view.sessionId);
      }
    }

    return out;
  }
}
