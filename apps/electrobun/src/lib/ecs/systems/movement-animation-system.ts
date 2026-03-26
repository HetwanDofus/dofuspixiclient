import { getCellPosition, getDirection } from "@dofus/grid";
import { System, system } from "@lastolivegames/becsy";

import {
  CellPosition,
  FrameTime,
  MapContext,
  MovementPath,
  SpriteState,
} from "@/ecs/components";

const WALK_SPEEDS = [0.07, 0.06, 0.06, 0.06, 0.07, 0.06, 0.06, 0.06];
const RUN_SPEEDS = [0.17, 0.15, 0.15, 0.15, 0.17, 0.15, 0.15, 0.15];
const MAX_FRAME_MS = 125;

@system
export class MovementAnimationSystem extends System {
  private movers = this.query(
    (q) =>
      q.current
        .with(MovementPath)
        .write.with(CellPosition)
        .write.with(SpriteState).write
  );
  private frameTime = this.singleton.read(FrameTime);
  private mapContext = this.singleton.read(MapContext);

  execute(): void {
    const deltaMs = this.frameTime.data.deltaMs;
    if (deltaMs <= 0) return;

    const clampedMs = Math.min(deltaMs, MAX_FRAME_MS);

    for (const entity of this.movers.current) {
      const movePath = entity.write(MovementPath);
      const path = movePath.path;
      if (!path || path.length < 2) continue;

      const currentStep = movePath.currentStep;
      if (currentStep >= path.length - 1) {
        // Path complete
        this.completePath(entity);
        continue;
      }

      const spriteState = entity.write(SpriteState);
      const container = spriteState.container;
      if (!container) continue;

      const fromCell = path[currentStep];
      const toCell = path[currentStep + 1];

      // Compute direction and movement vectors
      const mapWidth = this.mapContext.mapWidth || 15;
      const dir = getDirection(fromCell, toCell, mapWidth);
      const fromPos = getCellPosition(fromCell, mapWidth, 7);
      const toPos = getCellPosition(toCell, mapWidth, 7);

      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const totalDist = Math.sqrt(dx * dx + dy * dy);

      if (totalDist === 0) {
        movePath.currentStep = currentStep + 1;
        continue;
      }

      const angle = Math.atan2(dy, dx);
      const cosRot = Math.cos(angle);
      const sinRot = Math.sin(angle);

      // Speed based on direction and animation type
      const useRun = movePath.animationType === 1;
      const speed = useRun ? RUN_SPEEDS[dir] : WALK_SPEEDS[dir];
      const deltaPx = speed * clampedMs;

      // Calculate current progress distance
      const currentDx = container.x - fromPos.x;
      const currentDy = container.y - fromPos.y;
      const currentDist = Math.sqrt(
        currentDx * currentDx + currentDy * currentDy
      );
      const remainingDist = totalDist - currentDist;

      if (remainingDist <= deltaPx) {
        // Segment complete — snap to destination
        container.x = toPos.x;
        container.y = toPos.y;
        container.zIndex = toCell * 100 + 30;

        const cellPos = entity.write(CellPosition);
        cellPos.cellId = toCell;

        movePath.currentStep = currentStep + 1;
        movePath.progress = 0;

        if (movePath.currentStep >= path.length - 1) {
          this.completePath(entity);
        }
      } else {
        // Advance position
        container.x += deltaPx * cosRot;
        container.y += deltaPx * sinRot;
        movePath.progress = (currentDist + deltaPx) / totalDist;
      }
    }
  }

  private completePath(entity: any): void {
    const movePath = entity.write(MovementPath);
    movePath.path = [];
    movePath.currentStep = 0;
    movePath.progress = 0;

    // Remove MovementPath component to signal completion
    entity.remove(MovementPath);
  }
}
