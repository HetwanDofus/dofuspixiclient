export type { CharacterStats } from "@/game/types/stats";

export type { CharacterState } from "./character-store";
export type { ChatEntry, ChatState } from "./chat-store";
export type {
  ConnectionStatus,
  ConnectionUiState,
  LostCause,
} from "./connection-store";
export type { ContextMenuOption, ContextMenuState } from "./context-menu-store";
export type { FightMode, FightState } from "./fight-store";
export type { HudState, PanelName } from "./hud-store";
export type { InventoryState, InventoryWeight } from "./inventory-store";
export type {
  HotbarTab,
  ResolvedShortcut,
  ShortcutsState,
} from "./shortcuts-store";
export { characterStore } from "./character-store";
export {
  appendChatMessage,
  appendInfoMessage,
  chatStore,
  clearChat,
  setChannelVisible,
  setChatPrefix,
  setChatSide,
  toggleChatOpen,
} from "./chat-store";
export {
  connectionStore,
  markConnected,
  markLost,
  markReconnecting,
} from "./connection-store";
export {
  contextMenuStore,
  hideContextMenu,
  showContextMenu,
} from "./context-menu-store";
export { fightStore } from "./fight-store";
export { ExternalStore } from "./game-store";
export {
  closeAllPanels,
  hudStore,
  togglePanel,
  toggleWorldMap,
} from "./hud-store";
export {
  clearInventory,
  getBagItems,
  getEquippedAt,
  getEquippedItems,
  getTemplate,
  inventoryStore,
} from "./inventory-store";
export {
  HOTBAR_PAGES,
  HOTBAR_SLOTS_PER_PAGE,
  MAX_HOTBAR_SLOT,
  resolveShortcut,
  setHotbarTab,
  shortcutsStore,
  slotAt,
  stepHotbarPage,
  toggleHotbarTab,
} from "./shortcuts-store";
