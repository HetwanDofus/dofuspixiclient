import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import {
  type WaypointLeaveRequest,
  WaypointLeaveRequestSchema,
  type WaypointUseRequest,
  WaypointUseRequestSchema,
} from "@dofus/proto/world_pb";
import { WaypointsService } from "@modules/waypoints/waypoints.service";
import { Injectable } from "@nestjs/common";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";
import { SessionRegistry } from "@shared/gateway-adapter/session-registry";

@Injectable()
export class WaypointUseHandler {
  constructor(
    private readonly sessions: SessionRegistry,
    private readonly waypoints: WaypointsService
  ) {}

  @MessageHandler(WaypointUseRequestSchema)
  async handleUse(ctx: HandlerContext, msg: WaypointUseRequest): Promise<void> {
    const session = this.sessions.get(ctx.sessionId);
    if (!session?.characterId) {
      return;
    }
    await this.waypoints.teleportViaZaap(
      ctx.sessionId,
      session.characterId,
      msg.waypointId
    );
  }

  @MessageHandler(WaypointLeaveRequestSchema)
  handleLeave(ctx: HandlerContext, _msg: WaypointLeaveRequest): void {
    this.waypoints.leaveZaapMenu(ctx.sessionId);
  }
}
