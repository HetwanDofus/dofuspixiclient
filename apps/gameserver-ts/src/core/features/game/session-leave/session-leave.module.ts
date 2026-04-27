import { SessionLeaveSaga } from "@features/game/session-leave/session-leave.saga";
import { PlayerPresenceModule } from "@modules/player-presence/player-presence.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [PlayerPresenceModule],
  providers: [SessionLeaveSaga],
})
export class SessionLeaveModule {}
