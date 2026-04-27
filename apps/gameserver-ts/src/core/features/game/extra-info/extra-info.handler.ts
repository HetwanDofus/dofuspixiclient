import type { GameGetExtraInfo } from "@dofus/proto/game_pb";
import type { HandlerContext } from "@shared/gateway-adapter/ws-router";
import { GameGetExtraInfoSchema } from "@dofus/proto/game_pb";
import { Injectable } from "@nestjs/common";
import { MessageHandler } from "@shared/gateway-adapter/message-handler.decorator";

@Injectable()
export class ExtraInfoHandler {
  @MessageHandler(GameGetExtraInfoSchema)
  handle(_ctx: HandlerContext, _msg: GameGetExtraInfo): void {
    // Legacy GI — client signals it finished loading the map.
    // Future: send fight counts, interactive objects, etc.
  }
}
