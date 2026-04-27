import { FightLeaveHandler } from "@features/game/fight-leave/fight-leave.handler";
import { Module } from "@nestjs/common";

@Module({
  providers: [FightLeaveHandler],
})
export class FightLeaveModule {}
