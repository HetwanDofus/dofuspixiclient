import { useSyncExternalStore } from "react";

import {
  MainBanner,
  MainBannerButtons,
  MainBannerChat,
  MainBannerChatInput,
  MainBannerCircle,
  MainBannerGrid,
  MainBannerGridSlot,
  MainBannerHeart,
  MainBannerIconButton,
  MainBannerMorePanel,
  MainBannerRightPanel,
} from "@/components/ui/main-banner";
import { togglePanel, toggleWorldMap } from "@/stores";
import { characterStore } from "@/stores/character-store";

import { Minimap } from "../minimap/Minimap";

const ICON_BUTTONS = [
  { icon: "stats", panel: "stats" },
  { icon: "spells", panel: "spells" },
  { icon: "inventory", panel: "inventory" },
  { icon: "quests", panel: "quests" },
  { icon: "map", panel: "map" },
  { icon: "friends", panel: "friends" },
  { icon: "guild", panel: "guild" },
  { icon: "mount", panel: "mount" },
] as const;

export function BannerReact() {
  const { stats } = useSyncExternalStore(
    characterStore.subscribe,
    characterStore.getSnapshot,
  );

  const hp = stats?.hp ?? 100;
  const maxHp = stats?.maxHp ?? 100;

  const handleIconClick = (panel: string) => {
    if (panel === "map") {
      toggleWorldMap();
    } else {
      togglePanel(panel as never);
    }
  };

  return (
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 pointer-events-auto z-10">
      <MainBanner mode="normal">
        <MainBannerChat />
        <MainBannerChatInput placeholder="Chat here..." />

        <MainBannerCircle>
          <Minimap />
        </MainBannerCircle>

        <MainBannerHeart hp={hp} max={maxHp} />

        <MainBannerButtons>
          {ICON_BUTTONS.map(({ icon, panel }) => (
            <MainBannerIconButton
              key={icon}
              icon={icon}
              onClick={() => handleIconClick(panel)}
            />
          ))}
        </MainBannerButtons>

        <MainBannerMorePanel>
          <MainBannerIconButton
            icon="pvp"
            onClick={() => togglePanel("conquest")}
          />
          <MainBannerIconButton icon="job" />
          <MainBannerIconButton icon="achievement" />
          <MainBannerIconButton icon="event" />
          <MainBannerIconButton icon="title" />
        </MainBannerMorePanel>
        <MainBannerRightPanel />

        <MainBannerGrid
          tabs={[
            { value: "spells", label: "Sorts" },
            { value: "items", label: "Obj." },
          ]}
        >
          {Array.from({ length: 14 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: It's ok
            <MainBannerGridSlot key={i} />
          ))}
        </MainBannerGrid>
      </MainBanner>
    </div>
  );
}
