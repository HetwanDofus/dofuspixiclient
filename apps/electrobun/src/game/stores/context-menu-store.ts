import { ExternalStore } from "./game-store";

export interface ContextMenuOption {
  label: string;
  onClick: () => void;
}

export interface ContextMenuState {
  [key: string]: unknown;
  open: boolean;
  title: string;
  options: ContextMenuOption[];
  x: number;
  y: number;
}

const initialState: ContextMenuState = {
  open: false,
  title: "",
  options: [],
  x: 0,
  y: 0,
};

export const contextMenuStore = new ExternalStore<ContextMenuState>(
  initialState
);

export function showContextMenu(
  title: string,
  options: ContextMenuOption[],
  x: number,
  y: number
): void {
  contextMenuStore.setState({ open: true, title, options, x, y });
}

export function hideContextMenu(): void {
  contextMenuStore.setState({ open: false });
}
