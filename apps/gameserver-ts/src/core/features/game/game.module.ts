import { CharacterListModule } from "@features/game/character-list/character-list.module";
import { ChatModule } from "@features/game/chat/chat.module";
import { EnterGameModule } from "@features/game/enter-game/enter-game.module";
import { ExchangeTicketModule } from "@features/game/exchange-ticket/exchange-ticket.module";
import { ExtraInfoModule } from "@features/game/extra-info/extra-info.module";
import { FightChallengeModule } from "@features/game/fight-challenge/fight-challenge.module";
import { FightJoinModule } from "@features/game/fight-join/fight-join.module";
import { FightLeaveModule } from "@features/game/fight-leave/fight-leave.module";
import { FightPlacementModule } from "@features/game/fight-placement/fight-placement.module";
import { FightStartModule } from "@features/game/fight-start/fight-start.module";
import { FightTurnModule } from "@features/game/fight-turn/fight-turn.module";
import { GetMapDataModule } from "@features/game/get-map-data/get-map-data.module";
import { InteractiveUseModule } from "@features/game/interactive-use/interactive-use.module";
import { ItemMoveModule } from "@features/game/item-move/item-move.module";
import { ItemUseModule } from "@features/game/item-use/item-use.module";
import { MoveModule } from "@features/game/move/move.module";
import { MoveAckModule } from "@features/game/move-ack/move-ack.module";
import { NpcDialogModule } from "@features/game/npc-dialog/npc-dialog.module";
import { SelectCharacterModule } from "@features/game/select-character/select-character.module";
import { SessionLeaveModule } from "@features/game/session-leave/session-leave.module";
import { ShortcutsSliceModule } from "@features/game/shortcuts/shortcuts.module";
import { SpellDetailsModule } from "@features/game/spell-details/spell-details.module";
import { SpellMoveModule } from "@features/game/spell-move/spell-move.module";
import { SpellUpgradeModule } from "@features/game/spell-upgrade/spell-upgrade.module";
import { StatBoostModule } from "@features/game/stat-boost/stat-boost.module";
import { WaypointUseModule } from "@features/game/waypoint-use/waypoint-use.module";
import { FightModule } from "@modules/fight/fight.module";
import { Module } from "@nestjs/common";

@Module({
  imports: [
    FightModule,
    ExchangeTicketModule,
    CharacterListModule,
    SelectCharacterModule,
    EnterGameModule,
    ExtraInfoModule,
    GetMapDataModule,
    MoveModule,
    MoveAckModule,
    InteractiveUseModule,
    ItemMoveModule,
    ItemUseModule,
    StatBoostModule,
    ChatModule,
    FightStartModule,
    FightPlacementModule,
    FightJoinModule,
    FightTurnModule,
    FightLeaveModule,
    FightChallengeModule,
    SessionLeaveModule,
    SpellDetailsModule,
    SpellMoveModule,
    SpellUpgradeModule,
    ShortcutsSliceModule,
    WaypointUseModule,
    NpcDialogModule,
  ],
})
export class GameModule {}
