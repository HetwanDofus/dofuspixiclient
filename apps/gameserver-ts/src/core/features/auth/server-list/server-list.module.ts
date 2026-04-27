import { ServerListHandler } from "@features/auth/server-list/server-list.handler";
import { ServerListRepository } from "@features/auth/server-list/server-list.repository";
import { Module } from "@nestjs/common";

@Module({
  providers: [ServerListHandler, ServerListRepository],
})
export class ServerListModule {}
