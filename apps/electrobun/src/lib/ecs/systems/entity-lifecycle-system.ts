import { getCellPosition } from "@dofus/grid";
import { System, system } from "@lastolivegames/becsy";
import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";

import {
  ActorTag,
  CellPosition,
  FighterLook,
  SpriteState,
} from "@/ecs/components";
import { sharedRenderContext } from "@/ecs/world";

@system
export class EntityLifecycleSystem extends System {
  private entering = this.query(
    (q) =>
      q.added
        .with(ActorTag)
        .read.with(SpriteState)
        .write.with(CellPosition)
        .read.with(FighterLook).read
  );
  private exiting = this.query(
    (q) => q.removed.with(ActorTag).read.with(SpriteState).write
  );

  execute(): void {
    // Handle new actors
    for (const entity of this.entering.added) {
      const spriteState = entity.write(SpriteState);
      if (spriteState.container) continue; // Already initialized

      const cellPos = entity.read(CellPosition);
      const look = entity.read(FighterLook);
      const actorTag = entity.read(ActorTag);

      const container = new Container();
      container.label = `actor-${look.name}`;
      container.sortableChildren = true;

      // Placeholder graphics
      const placeholder = new Graphics();
      const color = actorTag.isCurrentPlayer ? 0x4444ff : 0xff4444;
      placeholder.circle(0, -10, 12);
      placeholder.fill({ color, alpha: 0.8 });
      placeholder.stroke({ color: 0x000000, width: 2 });
      placeholder.circle(0, -25, 8);
      placeholder.fill({ color, alpha: 0.9 });
      placeholder.stroke({ color: 0x000000, width: 2 });
      container.addChild(placeholder);

      // Name text
      const nameStyle = new TextStyle({
        fontFamily: "Arial",
        fontSize: 10,
        fontWeight: "bold",
        fill: actorTag.isCurrentPlayer ? 0x66ff66 : 0xffffff,
        stroke: { color: 0x000000, width: 2 },
        align: "center",
      });
      const nameText = new Text({ text: look.name, style: nameStyle });
      nameText.anchor.set(0.5, 1);
      nameText.y = -50;
      container.addChild(nameText);

      // Position at cell
      const pos = getCellPosition(cellPos.cellId, 15, cellPos.groundLevel);
      container.x = pos.x;
      container.y = pos.y;
      container.zIndex = cellPos.cellId * 100 + 30;

      // Add to actors container
      const actorsContainer = sharedRenderContext.actorsContainer;
      if (actorsContainer) {
        actorsContainer.addChild(container);
      }

      spriteState.container = container;

      // Start async sprite loading
      if (spriteState.gfxId > 0) {
        this.loadSprite(spriteState);
      }
    }

    // Handle removed actors
    for (const entity of this.exiting.removed) {
      const spriteState = entity.write(SpriteState);
      if (spriteState.container) {
        spriteState.container.parent?.removeChild(spriteState.container);
        spriteState.container.destroy({ children: true });
        spriteState.container = null;
      }
    }
  }

  private async loadSprite(
    spriteState: SpriteState,
  ): Promise<void> {
    if (spriteState.spriteLoading) return;
    spriteState.spriteLoading = true;

    const loader = sharedRenderContext.spriteLoader;
    if (!loader) {
      spriteState.spriteLoading = false;
      return;
    }

    const result = await loader.loadAnimationWithFallback(
      spriteState.gfxId,
      "static",
      1 // default direction SE
    );

    spriteState.spriteLoading = false;

    if (!result || !spriteState.container) return;

    const { animation, animName } = result;
    spriteState.currentAnimData = animation;
    spriteState.currentAnimName = animName;
    spriteState.frameIndex = 0;
    spriteState.frameTimer = 0;

    // Remove placeholder (first child)
    if (spriteState.container.children.length > 0) {
      const firstChild = spriteState.container.children[0];
      if (firstChild instanceof Graphics) {
        spriteState.container.removeChild(firstChild);
        firstChild.destroy();
      }
    }

    // Create sprite
    const sprite = new Sprite(animation.textures[0]);
    sprite.anchor.set(0, 0);
    sprite.x = animation.offsetX;
    sprite.y = animation.offsetY;
    sprite.zIndex = 0;
    spriteState.container.addChildAt(sprite, 0);
  }
}
