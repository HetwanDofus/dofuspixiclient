import type { ISpellAnimation } from "@dofus/spell-runtime";

import type { Scene } from "@/game/scene/scene";
import { Actor, type ActorId, freshActorId } from "@/game/scene/actor";
import { TICKABLE, type Tickable } from "@/game/scene/capabilities";

/**
 * Tickable scene actor wrapping an in-flight ISpellAnimation. The scene drives
 * update(); the actor self-removes from the scene once the animation reports
 * complete (or via markComplete() from an external trigger).
 *
 * `resolve` is the Promise resolver returned by SpellRenderer.playSpell — it
 * fires exactly once (on markComplete or dispose).
 */
export class SpellActor extends Actor implements Tickable {
  readonly id: ActorId;
  readonly [TICKABLE] = true as const;

  complete = false;

  constructor(
    private readonly scene: Scene,
    readonly spell: ISpellAnimation,
    private readonly resolve: () => void,
    private readonly onDispose: (actor: SpellActor) => void
  ) {
    super();
    this.id = freshActorId();
  }

  update(dt: number): void {
    try {
      this.spell.update(dt, 0);
    } catch (err) {
      console.warn("Spell update error:", err);
    }

    if (this.spell.isComplete() || this.complete) {
      this.scene.remove(this.id);
    }
  }

  markComplete(): void {
    if (this.complete) {
      return;
    }

    this.complete = true;
    this.resolve();
  }

  dispose(): void {
    this.onDispose(this);

    try {
      this.spell.destroy();
    } catch {
      // Swallow — the actor is going away regardless.
    }

    if (!this.complete) {
      this.complete = true;
      this.resolve();
    }
  }
}
