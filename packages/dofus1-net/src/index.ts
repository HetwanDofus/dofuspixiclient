export type {
  CharacterEntry,
  GameServerEntry,
} from "./protocol/types";
export type { TcpSocketOptions } from "./transport/tcp-socket";
export {
  Client,
  type ClientEvents,
  type ConnectOptions,
  setTransportFactory,
  type TransportFactory,
} from "./client";
export {
  type DispatchResult,
  dispatch,
} from "./dispatcher";
export * as parse from "./protocol/parse";
export * as serialize from "./protocol/serialize";
export {
  type Direction,
  defineMessage,
  getMessageByOpcode,
  type InboundDef,
  listOpcodes,
  type MessageDef,
  type OutboundDef,
} from "./registry";
export {
  Crypto,
  checksum,
  cypher,
  decypher,
  prepareKey,
} from "./transport/crypto";
export {
  encodeFrame,
  FrameReader,
} from "./transport/framing";
export {
  openTcpSocket,
  type TcpSocketHandle,
} from "./transport/tcp-socket";
export {
  buildOutboundFrame,
  Composite,
  F,
  opcodeOf,
  type WireClass,
  WireIn,
  type WireInClass,
  WireOut,
  type WireOutClass,
} from "./wire";

// Register every message by importing the file at module load. Each
// per-message file's `@WireIn` decorator inserts itself into the
// opcode registry as a side-effect.
import "./messages/hello/connection";
import "./messages/hello/telemetry";
import "./messages/hello/game-server";
import "./messages/hello/switch-ticket";
import "./messages/account/login";
import "./messages/account/characters";
import "./messages/account/servers";
import "./messages/account/select-server";
import "./messages/account/select-server-compact";
import "./messages/account/select-character";
import "./messages/account/send-ticket";
import "./messages/account/network-key";
import "./messages/account/key-ack";
import "./messages/account/hosts";
import "./messages/account/regional-version";
import "./messages/account/community";
import "./messages/account/dofus-pseudo";
import "./messages/account/restrictions";
import "./messages/account/queue";
import "./messages/account/new-queue";
import "./messages/game/create";
import "./messages/game/map-data";
import "./messages/game/movement";
import "./messages/game/map-loaded";
import "./messages/game/game-end";
import "./messages/waypoints/create";
import "./messages/waypoints/leave";
import "./messages/waypoints/use-error";
import "./messages/system/pong";
import "./messages/system/quick-pong";
import "./messages/system/random-ping";
import "./messages/system/server-message";
import "./messages/system/server-will-disconnect";
import "./messages/system/basics-null";
import "./messages/game/start-to-play";
import "./messages/game/turn-start";
import "./messages/game/turn-finish";
import "./messages/game/turn-list";
import "./messages/game/turn-middle";
import "./messages/game/turn-ready";
import "./messages/game/position-start";
import "./messages/game/info-coordinates";
import "./messages/game/ready";
import "./messages/game/join";
import "./messages/game/actions-start";
import "./messages/game/actions-finish";
import "./messages/game/action";
import "./messages/chat/message";
import "./messages/items/add";
import "./messages/items/remove";
import "./messages/items/quantity";
import "./messages/items/weight";
import "./messages/info/info-message";
import "./messages/account/stats";
import "./messages/game/placement";
import "./messages/game/turn-end";
import "./messages/game/surrender";
import "./messages/game/extra-info";
import "./messages/game/action-ack";
import "./messages/admin/authorized-command";

export { AL } from "./messages/account/characters";
export { Ac } from "./messages/account/community";
export { Ad } from "./messages/account/dofus-pseudo";
export { AH, HostStatus } from "./messages/account/hosts";
export { AkOut } from "./messages/account/key-ack";
export { Al } from "./messages/account/login";
export {
  buildLoginFrame,
  cryptPassword,
} from "./messages/account/login-credentials";
export { AK } from "./messages/account/network-key";
export { Af, AfOut } from "./messages/account/new-queue";
export { Aq } from "./messages/account/queue";
export { AV, AVOut } from "./messages/account/regional-version";
export { AR } from "./messages/account/restrictions";
export { AS, ASOut } from "./messages/account/select-character";
export { AX, AXOut } from "./messages/account/select-server";
export { AY } from "./messages/account/select-server-compact";
export { AT, ATOut } from "./messages/account/send-ticket";
export { Ax } from "./messages/account/servers";
export { As } from "./messages/account/stats";
export {
  BAC,
  BAE,
  BAL,
  BAl,
  BAOut,
  BAP,
  BAT,
} from "./messages/admin/authorized-command";
export { CM, CMOut } from "./messages/chat/message";
export { GA, GAOut } from "./messages/game/action";
export { GKKOut } from "./messages/game/action-ack";
export { GAF } from "./messages/game/actions-finish";
export { GAS } from "./messages/game/actions-start";
export { GC } from "./messages/game/create";
export { GIOut } from "./messages/game/extra-info";
export { GE } from "./messages/game/game-end";
export { GJ } from "./messages/game/join";
export { GDM } from "./messages/game/map-data";
export { GDK } from "./messages/game/map-loaded";
export {
  GM,
  type GMRow,
  type GMSpriteAdd,
  type GMSpriteRemove,
  type SpriteKind,
} from "./messages/game/movement";
export { GpOut } from "./messages/game/placement";
export { GP } from "./messages/game/position-start";
export { GIC, type GICCoordRow } from "./messages/game/info-coordinates";
export { GR, GROut } from "./messages/game/ready";
export { GS } from "./messages/game/start-to-play";
export { GFOut } from "./messages/game/surrender";
export { GtOut } from "./messages/game/turn-end";
export { GTF } from "./messages/game/turn-finish";
export { GTL } from "./messages/game/turn-list";
export { GTM } from "./messages/game/turn-middle";
export { GTR } from "./messages/game/turn-ready";
export { GTS } from "./messages/game/turn-start";
// Re-export the message defs so consumers can pass them to
// Client.on / Client.send for compile-time typing.
export { HC } from "./messages/hello/connection";
export { HG } from "./messages/hello/game-server";
export { HS } from "./messages/hello/switch-ticket";
export { HT } from "./messages/hello/telemetry";
export { Im } from "./messages/info/info-message";
export { OA } from "./messages/items/add";
export { OQ } from "./messages/items/quantity";
export { OR } from "./messages/items/remove";
export { Ow } from "./messages/items/weight";
export { BasicsNull } from "./messages/system/basics-null";
export { PING_FRAME, QUICK_PING_FRAME } from "./messages/system/ping";
export { Pong } from "./messages/system/pong";
export { QuickPong } from "./messages/system/quick-pong";
export { RandomPing, RandomPingOut } from "./messages/system/random-ping";
export { ServerMessage } from "./messages/system/server-message";
export { ServerWillDisconnect } from "./messages/system/server-will-disconnect";
export { WaypointEntry, WC } from "./messages/waypoints/create";
export { WV } from "./messages/waypoints/leave";
export { WU } from "./messages/waypoints/use-error";
