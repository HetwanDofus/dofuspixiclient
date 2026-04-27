import { ExtraInfoHandler } from "@features/game/extra-info/extra-info.handler";
import { Module } from "@nestjs/common";

@Module({
  providers: [ExtraInfoHandler],
})
export class ExtraInfoModule {}
