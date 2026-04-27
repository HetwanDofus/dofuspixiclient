import { SelectServerHandler } from "@features/auth/select-server/select-server.handler";
import { SelectServerRepository } from "@features/auth/select-server/select-server.repository";
import { Module } from "@nestjs/common";

@Module({
  providers: [SelectServerHandler, SelectServerRepository],
})
export class SelectServerModule {}
