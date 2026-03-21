import { Container, Graphics, Text } from "pixi.js";

import { boldText, COLORS, METRICS, regularText } from "./theme";

export interface TabConfig {
  key: string;
  label: string;
}

export class TabBar {
  public container: Container;
  public tabHeight: number;

  private tabs: TabConfig[];
  private width: number;
  private zoom: number;
  private activeKey: string;
  private onChange?: (key: string) => void;
  private tabContainers: Container[] = [];

  constructor(tabs: TabConfig[], width: number, zoom: number) {
    this.tabs = tabs;
    this.width = width;
    this.zoom = zoom;
    this.activeKey = tabs[0]?.key ?? "";
    this.container = new Container();
    this.tabHeight = Math.round(METRICS.HEADER_H * zoom);
    this.build();
  }

  private build(): void {
    const z = this.zoom;
    const tabW = this.width / this.tabs.length;
    const tabH = this.tabHeight;
    this.tabContainers = [];

    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i];
      const isActive = tab.key === this.activeKey;
      const tc = new Container();
      tc.x = Math.round(tabW * i);
      tc.eventMode = "static";
      tc.cursor = "pointer";

      const bg = new Graphics();
      bg.rect(0, 0, Math.ceil(tabW), tabH);
      bg.fill({ color: isActive ? COLORS.HEADER_BG : COLORS.BG_ALT });
      // Bottom border separator
      bg.rect(0, tabH - 1, Math.ceil(tabW), 1);
      bg.fill({ color: COLORS.BORDER });
      tc.addChild(bg);

      const label = new Text({
        text: tab.label,
        style: isActive
          ? boldText(Math.max(9 * z, 8), COLORS.TEXT_WHITE)
          : regularText(Math.max(9 * z, 8), COLORS.TEXT_DARK),
      });
      label.anchor.set(0.5, 0.5);
      label.x = Math.ceil(tabW) / 2;
      label.y = tabH / 2;
      tc.addChild(label);

      tc.on("pointerdown", () => {
        if (tab.key !== this.activeKey) {
          this.setActiveTab(tab.key);
          this.onChange?.(tab.key);
        }
      });

      this.container.addChild(tc);
      this.tabContainers.push(tc);
    }
  }

  setActiveTab(key: string): void {
    this.activeKey = key;
    this.container.removeChildren();
    this.build();
  }

  onTabChange(callback: (key: string) => void): void {
    this.onChange = callback;
  }

  rebuild(width: number, zoom: number): void {
    this.width = width;
    this.zoom = zoom;
    this.tabHeight = Math.round(METRICS.HEADER_H * zoom);
    this.container.removeChildren();
    this.build();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
