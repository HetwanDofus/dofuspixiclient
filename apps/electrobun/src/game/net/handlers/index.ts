// Single entry point for wiring every opcode handler. Call this once
// after the game socket reaches `in-game` stage (or earlier — handlers
// that fire on auth-side frames simply never run on the game socket).
//
// Each register* function subscribes against `Client.on(MessageClass,
// handler)`; subscribers are bound to the current `inner Client`
// instance inside `NetClient`. If the connection swaps (e.g. crash +
// reconnect), call `registerAllHandlers` again after the new
// `connect()` resolves — the old subscriptions are dropped along
// with the previous Client.

import type { NetClient } from "@/game/net/client";

import { registerAuthorizedCommand } from "./admin/authorized";
import { registerChatMessage } from "./chat/message";
import { registerAction } from "./fight/action";
import { registerActionsFinish } from "./fight/actions-finish";
import { registerActionsStart } from "./fight/actions-start";
import { registerGameEnd } from "./fight/game-end";
import { registerInfoCoordinates } from "./fight/info-coordinates";
import { registerJoin } from "./fight/join";
import { registerPositionStart } from "./fight/position-start";
import { registerReady } from "./fight/ready";
import { registerStartToPlay } from "./fight/start-to-play";
import { registerTurnFinish } from "./fight/turn-finish";
import { registerTurnList } from "./fight/turn-list";
import { registerTurnMiddle } from "./fight/turn-middle";
import { registerTurnReady } from "./fight/turn-ready";
import { registerTurnStart } from "./fight/turn-start";
import { registerInfoMessage } from "./info/info-message";
import { registerItemAdd } from "./items/add";
import { registerItemQuantity } from "./items/quantity";
import { registerItemRemove } from "./items/remove";
import { registerItemWeight } from "./items/weight";
import { registerServerMessage } from "./system/server-message";
import { registerWaypointCreate } from "./waypoints/create";
import { registerWaypointLeave } from "./waypoints/leave";
import { registerWaypointUseError } from "./waypoints/use-error";
import { registerAdjacentMapsData } from "./world/adjacent-maps-data";
import { registerMapLoaded } from "./world/map-loaded";
import { registerMovement } from "./world/movement";

export function registerAllHandlers(client: NetClient): void {
  // Fight lifecycle
  registerJoin(client);
  registerPositionStart(client);
  registerInfoCoordinates(client);
  registerReady(client);
  registerStartToPlay(client);
  registerTurnStart(client);
  registerTurnFinish(client);
  registerTurnList(client);
  registerTurnMiddle(client);
  registerTurnReady(client);
  registerActionsStart(client);
  registerActionsFinish(client);
  registerAction(client);
  registerGameEnd(client);

  // World / roleplay
  registerAdjacentMapsData(client);
  registerMapLoaded(client);
  registerMovement(client);

  // Chat + info
  registerChatMessage(client);
  registerInfoMessage(client);
  registerServerMessage(client);

  // Admin console (BA* opcode family) — must run before the side chat
  // handler can swallow ambiguous BA* lines, hence registered up top.
  registerAuthorizedCommand(client);

  // Inventory
  registerItemAdd(client);
  registerItemRemove(client);
  registerItemQuantity(client);
  registerItemWeight(client);

  // Zaaps
  registerWaypointCreate(client);
  registerWaypointLeave(client);
  registerWaypointUseError(client);
}

// Re-export subscription hooks for non-store consumers (battlefield UI,
// map loader, zaap modal).
export { type FightActionEvent, onFightAction } from "./fight/action";
export { onPlayerCoords } from "./fight/info-coordinates";
export { onPositionStart } from "./fight/position-start";
export { onWaypointOpen } from "./waypoints/create";
export { onWaypointClose } from "./waypoints/leave";
export {
  type AdjacentMapsListener,
  onAdjacentMapsData,
} from "./world/adjacent-maps-data";
export { type MovementListeners, onMovement } from "./world/movement";
