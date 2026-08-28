"use client";

import { cva, type VariantProps } from "class-variance-authority";
import {
  createContext,
  type ReactNode,
  useContext,
  useId,
  useState,
} from "react";
import { match } from "ts-pattern";

import AchievementIcon from "./icons/banner/achievement";
import { ButtonBgDown, ButtonBgUp } from "./icons/banner/button-bg";
import {
  ButtonChatDown,
  ButtonChatUp,
  ButtonEmoteDown,
  ButtonEmoteUp,
  ButtonSitDown,
  ButtonSitUp,
} from "./icons/banner/chat-header-buttons";
import EventIcon from "./icons/banner/event";
import FriendsIcon from "./icons/banner/friends";
import GuildIcon from "./icons/banner/guild";
import InventoryIcon from "./icons/banner/inventory";
import JobIcon from "./icons/banner/job";
import LessIcon from "./icons/banner/less";
import MapIcon from "./icons/banner/map";
import MoreIcon from "./icons/banner/more";
import MountIcon from "./icons/banner/mount";
import { PercentSign } from "./icons/banner/percent-sign";
import PvpIcon from "./icons/banner/pvp";
import QuestsIcon from "./icons/banner/quests";
import SpellsIcon from "./icons/banner/spells";
import StatsIcon from "./icons/banner/stats";
import TitleIcon from "./icons/banner/title";
import { TurnButtonDown, TurnButtonUp } from "./icons/banner/turn-button";
import { Scrollbar } from "./scrollbar";

const BANNER_ICONS = {
  stats: StatsIcon,
  spells: SpellsIcon,
  inventory: InventoryIcon,
  quests: QuestsIcon,
  map: MapIcon,
  friends: FriendsIcon,
  guild: GuildIcon,
  pvp: PvpIcon,
  mount: MountIcon,
  job: JobIcon,
  achievement: AchievementIcon,
  event: EventIcon,
  title: TitleIcon,
  more: MoreIcon,
  less: LessIcon,
} as const;

type BannerIconName = keyof typeof BANNER_ICONS;

import { Tabs } from "@base-ui/react/tabs";

import { cn } from "@/lib/utils";

type BannerMode = "normal" | "fight";
interface MainBannerContextValue {
  mode: BannerMode;
  circleExpanded: boolean;
  setCircleExpanded: (expanded: boolean) => void;
}

const MainBannerContext = createContext<MainBannerContextValue>({
  mode: "normal",
  circleExpanded: false,
  setCircleExpanded: () => {},
});

function useBannerMode() {
  return useContext(MainBannerContext).mode;
}

function useCircleExpanded() {
  return useContext(MainBannerContext).circleExpanded;
}

function useSetCircleExpanded() {
  return useContext(MainBannerContext).setCircleExpanded;
}

const bannerVariants = cva("relative select-none", {
  variants: {
    mode: {
      normal: "",
      fight: "",
    },
  },
  defaultVariants: { mode: "normal" },
});

interface MainBannerProps extends VariantProps<typeof bannerVariants> {
  className?: string;
  children?: ReactNode;
}

function MainBanner({ mode = "normal", className, children }: MainBannerProps) {
  const [circleExpanded, setCircleExpanded] = useState(false);

  return (
    <MainBannerContext.Provider
      value={{
        mode: mode ?? "normal",
        circleExpanded,
        setCircleExpanded,
      }}
    >
      <div
        className={cn(
          bannerVariants({ mode }),
          "w-[calc(742px*var(--resolution-factor))]",
          "h-[calc(123.95px*var(--resolution-factor))]",
          className,
        )}
      >
        <div
          className={cn(
            "absolute bg-main-banner-bg",
            "top-0",
            "w-[calc(742px*var(--resolution-factor))]",
            "h-[calc(123.95px*var(--resolution-factor))]",
          )}
        />
        <div
          className={cn(
            "absolute bg-main-banner-header-bg",
            "left-[calc(415px*var(--resolution-factor))]",
            "top-0",
            "w-[calc(327px*var(--resolution-factor))]",
            "h-[calc(40px*var(--resolution-factor))]",
          )}
        />
        <div
          className={cn(
            "absolute bg-main-banner-chat-input-bg",
            "left-0",
            "top-[calc(104px*var(--resolution-factor))]",
            "w-[calc(415px*var(--resolution-factor))]",
            "h-[calc(19.95px*var(--resolution-factor))]",
          )}
        />
        {children}
      </div>
    </MainBannerContext.Provider>
  );
}

function MainBannerChatScrollBar({ expanded = false }: { expanded?: boolean }) {
  return (
    <Scrollbar
      axis="vertical"
      className={cn(
        "absolute",
        "left-[calc(3px*var(--resolution-factor))]",
        "top-[calc(20px*var(--resolution-factor))]",
        expanded
          ? "h-[calc(430px*var(--resolution-factor))]"
          : "h-[calc(80px*var(--resolution-factor))]",
      )}
    />
  );
}

const CHAT_FILTERS = [
  { label: "General", colorClassName: "bg-[#009900]" },
  { label: "Team", colorClassName: "bg-[#000000]" },
  { label: "Party", colorClassName: "bg-[#0066ff]" },
  { label: "Guild", colorClassName: "bg-[#663399]" },
  { label: "Alignment", colorClassName: "bg-[#ff8400]" },
  { label: "Trade", colorClassName: "bg-[#737373]" },
  { label: "Recruitment", colorClassName: "bg-[#663300]" },
  { label: "Event", colorClassName: "bg-[#a301da]" },
] as const;

function ChatFilterCheckbox({
  colorClassName,
  label,
  defaultChecked = true,
  onChange,
}: {
  colorClassName: string;
  label: string;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  const [checked, setChecked] = useState(defaultChecked);
  const id = useId();

  return (
    <label
      htmlFor={id}
      className={cn(
        "relative inline-block cursor-pointer",
        "w-[calc(12px*var(--resolution-factor))]",
        "h-[calc(12px*var(--resolution-factor))]",
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(e) => {
          setChecked(e.target.checked);
          onChange?.(e.target.checked);
        }}
        className="sr-only"
      />
      <div
        className={cn(
          "absolute inset-0",
          "border-[calc(1px*var(--resolution-factor))] border-[#d5cfaa]",
          colorClassName,
        )}
      />
      {checked && (
        <svg
          viewBox="0 0 7.1 6.95"
          className={cn(
            "absolute",
            "left-[calc(2.5px*var(--resolution-factor))]",
            "top-[calc(2.5px*var(--resolution-factor))]",
            "w-[calc(7.1px*var(--resolution-factor))]",
            "h-[calc(6.95px*var(--resolution-factor))]",
          )}
          fill="#ffffff"
          role="img"
        >
          <title>Checked</title>
          <path d="M7.1 2.35L6.9 2.75L2.9 6.75L2.5 6.95L2.3 6.9L2.25 6.9L0.15 4.75L0 4.4L0.05 2.5Q0.05 1.95 0.6 1.95L1 2.15L2.6 3.95L6.05 0.25Q6.35 0 6.5 0Q7.1 0 7.1 0.6L7.1 2.35" />
        </svg>
      )}
    </label>
  );
}

function MainBannerChatFilters() {
  return (
    <div
      className={cn(
        "absolute flex",
        "left-[calc(237.95px*var(--resolution-factor))]",
        "top-[calc(10px*var(--resolution-factor))]",
        "gap-[calc(2px*var(--resolution-factor))]",
      )}
    >
      {CHAT_FILTERS.map(({ label, colorClassName }) => (
        <ChatFilterCheckbox
          key={label}
          label={label}
          colorClassName={colorClassName}
        />
      ))}
    </div>
  );
}

const SMILEY_COUNT = 5 * 3;
const EMOTE_COUNT = 12 * 3;

function MainBannerChatEmotePopup() {
  return (
    <div
      role="dialog"
      aria-label="Emotes and smileys"
      className={cn(
        "absolute z-30",
        "left-[calc(19px*var(--resolution-factor))]",
        "top-[calc(-67px*var(--resolution-factor))]",
        "w-[calc(353px*var(--resolution-factor))]",
        "h-[calc(67px*var(--resolution-factor))]",
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-0 bg-white/70",
          "w-[calc(353px*var(--resolution-factor))]",
          "h-[calc(1px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute left-0 bg-white/70",
          "top-[calc(1px*var(--resolution-factor))]",
          "w-[calc(1px*var(--resolution-factor))]",
          "h-[calc(66px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute bg-white/70",
          "left-[calc(352px*var(--resolution-factor))]",
          "top-[calc(1px*var(--resolution-factor))]",
          "w-[calc(1px*var(--resolution-factor))]",
          "h-[calc(66px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute bg-[#d5cfaa]/50",
          "left-[calc(1px*var(--resolution-factor))]",
          "top-[calc(1px*var(--resolution-factor))]",
          "w-[calc(351px*var(--resolution-factor))]",
          "h-[calc(66px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute grid grid-cols-5 grid-rows-3",
          "left-[calc(4px*var(--resolution-factor))]",
          "top-[calc(4px*var(--resolution-factor))]",
          "w-[calc(100px*var(--resolution-factor))]",
          "h-[calc(60px*var(--resolution-factor))]",
        )}
      >
        {Array.from({ length: SMILEY_COUNT }, (_, i) => (
          <button
            type="button"
            key={`smiley-${i}`}
            aria-label={`Smiley ${i + 1}`}
            className={cn(
              "cursor-pointer border-none bg-transparent p-0",
              "hover:bg-white/40",
            )}
          />
        ))}
      </div>
      <div
        className={cn(
          "absolute bg-white/50",
          "left-[calc(106px*var(--resolution-factor))]",
          "top-[calc(6px*var(--resolution-factor))]",
          "w-[calc(1px*var(--resolution-factor))]",
          "h-[calc(56px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute grid grid-cols-12 grid-rows-3",
          "left-[calc(109px*var(--resolution-factor))]",
          "top-[calc(4px*var(--resolution-factor))]",
          "w-[calc(240px*var(--resolution-factor))]",
          "h-[calc(60px*var(--resolution-factor))]",
        )}
      >
        {Array.from({ length: EMOTE_COUNT }, (_, i) => (
          <button
            type="button"
            key={`emote-${i}`}
            aria-label={`Emote ${i + 1}`}
            className={cn(
              "cursor-pointer border-none bg-transparent p-0",
              "hover:bg-white/40",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function MainBannerChatHeaderButton({
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn(
        "absolute cursor-pointer border-none bg-transparent p-0",
        "top-[calc(0.1px*var(--resolution-factor))]",
        "h-[calc(14px*var(--resolution-factor))]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function MainBannerChat({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);

  return (
    <div
      className={cn(
        "absolute",
        "left-[calc(0.5px*var(--resolution-factor))]",
        "w-[calc(412px*var(--resolution-factor))]",
        chatExpanded
          ? [
              "top-[calc(-349px*var(--resolution-factor))]",
              "h-[calc(453px*var(--resolution-factor))]",
            ]
          : "h-[calc(103px*var(--resolution-factor))]",
        className,
      )}
    >
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 bg-white",
          "w-[calc(420px*var(--resolution-factor))]",
          "rounded-tr-[calc(10px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute left-0 bottom-0 bg-[#8c8568]",
          "top-[calc(6px*var(--resolution-factor))]",
          "w-[calc(415px*var(--resolution-factor))]",
          "rounded-tr-[calc(10px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute left-0 right-0 bottom-0 bg-[#d5cfaa]",
          "top-[calc(16px*var(--resolution-factor))]",
          "rounded-tr-[calc(10px*var(--resolution-factor))]",
        )}
      />
      <MainBannerChatHeaderButton
        className="left-0 w-[calc(17px*var(--resolution-factor))]"
        onClick={() => setChatExpanded((e) => !e)}
        aria-label={chatExpanded ? "Collapse chat" : "Expand chat"}
        aria-pressed={chatExpanded}
      >
        {chatExpanded ? (
          <ButtonChatDown className="absolute inset-0 w-full h-full" />
        ) : (
          <ButtonChatUp className="absolute inset-0 w-full h-full" />
        )}
      </MainBannerChatHeaderButton>
      <MainBannerChatHeaderButton
        className="left-[calc(19px*var(--resolution-factor))] w-[calc(20px*var(--resolution-factor))]"
        onClick={() => setEmoteOpen((o) => !o)}
        aria-label="Open emotes"
        aria-pressed={emoteOpen}
      >
        {emoteOpen ? (
          <ButtonEmoteDown className="absolute inset-0 w-full h-full" />
        ) : (
          <ButtonEmoteUp className="absolute inset-0 w-full h-full" />
        )}
      </MainBannerChatHeaderButton>
      <MainBannerChatHeaderButton
        className="group/chatbtn-3 left-[calc(41px*var(--resolution-factor))] w-[calc(20px*var(--resolution-factor))]"
        aria-label="Sit down"
      >
        <ButtonSitUp className="absolute inset-0 w-full h-full group-active/chatbtn-3:hidden" />
        <ButtonSitDown className="absolute inset-0 w-full h-full hidden group-active/chatbtn-3:block" />
      </MainBannerChatHeaderButton>
      {emoteOpen && <MainBannerChatEmotePopup />}
      <MainBannerChatFilters />
      <MainBannerChatScrollBar expanded={chatExpanded} />
      <div
        className={cn(
          "absolute overflow-hidden",
          "left-[calc(20px*var(--resolution-factor))]",
          "top-[calc(20px*var(--resolution-factor))]",
          "w-[calc(330px*var(--resolution-factor))]",
          chatExpanded
            ? "h-[calc(430px*var(--resolution-factor))]"
            : "h-[calc(80px*var(--resolution-factor))]",
          "font-[Verdana,sans-serif] text-black",
          "text-[calc(10px*var(--resolution-factor))]",
          "leading-[calc(12px*var(--resolution-factor))]",
        )}
      >
        {children}
      </div>
    </div>
  );
}

function MainBannerChatInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type="text"
      className={cn(
        "absolute bg-transparent text-main-banner-circle-bg font-[Verdana,sans-serif] outline-none",
        "left-[calc(21px*var(--resolution-factor))]",
        "top-[calc(107px*var(--resolution-factor))]",
        "w-[calc(385px*var(--resolution-factor))]",
        "h-[calc(16px*var(--resolution-factor))]",
        "text-[calc(10px*var(--resolution-factor))]",
        className,
      )}
      {...props}
    />
  );
}

type MainBannerCircleChildren =
  | ReactNode
  | ((state: { isExpanded: boolean }) => ReactNode);

function circleRingArc(
  percent: number,
  cx: number,
  cy: number,
  r1: number,
  r2: number,
) {
  if (percent <= 0) {
    return "";
  }

  if (percent >= 1) {
    return [
      `M${cx},${cy - r2}`,
      `A${r2},${r2} 0 1 1 ${cx - 0.001},${cy - r2}`,
      `L${cx - 0.001},${cy - r1}`,
      `A${r1},${r1} 0 1 0 ${cx},${cy - r1}`,
      "Z",
    ].join(" ");
  }
  const a = percent * 2 * Math.PI;
  const large = percent > 0.5 ? 1 : 0;
  const ex2 = cx + r2 * Math.sin(a);
  const ey2 = cy - r2 * Math.cos(a);
  const ex1 = cx + r1 * Math.sin(a);
  const ey1 = cy - r1 * Math.cos(a);
  return [
    `M${cx},${cy - r2}`,
    `A${r2},${r2} 0 ${large} 1 ${ex2},${ey2}`,
    `L${ex1},${ey1}`,
    `A${r1},${r1} 0 ${large} 0 ${cx},${cy - r1}`,
    "Z",
  ].join(" ");
}

function MainBannerCircle({
  className,
  children,
  fill = 0,
  fillColor = "#ff6600",
}: {
  className?: string;
  children?: MainBannerCircleChildren;
  fill?: number;
  fillColor?: string;
}) {
  const mode = useBannerMode();
  const expanded = useCircleExpanded();
  const setExpanded = useSetCircleExpanded();
  const isExpanded = mode === "normal" && expanded;
  const maskId = useId();
  const hasChildren = children !== undefined && children !== null;
  const renderedChildren =
    typeof children === "function" ? children({ isExpanded }) : children;

  return (
    <div
      role="none"
      className={cn(
        "absolute z-10 pointer-events-none",
        "[clip-path:inset(-9999px_-9999px_calc((119px-117.95px)*var(--resolution-factor))_-9999px)]",
        "left-[calc(358px*var(--resolution-factor))]",
        "top-[calc(6px*var(--resolution-factor))]",
        "w-[calc(119px*var(--resolution-factor))]",
        "h-[calc(119px*var(--resolution-factor))]",
        className,
      )}
    >
      <div
        className={cn(
          "absolute rounded-full",
          "left-[calc(-5px*var(--resolution-factor))]",
          "top-0",
          "w-[calc(119px*var(--resolution-factor))]",
          "h-[calc(119px*var(--resolution-factor))]",
          "bg-(--main-banner-circle-shadow)",
        )}
      />
      <div
        className={cn(
          "absolute rounded-full",
          "left-[calc(5px*var(--resolution-factor))]",
          "top-0",
          "w-[calc(119px*var(--resolution-factor))]",
          "h-[calc(119px*var(--resolution-factor))]",
          "bg-(--main-banner-circle-shadow)",
        )}
      />
      <div
        className={cn(
          "absolute rounded-full box-border border-main-banner-circle-border",
          "left-0 top-0",
          "w-[calc(119px*var(--resolution-factor))]",
          "h-[calc(119px*var(--resolution-factor))]",
          "border-[calc(4px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute rounded-full box-border border-main-banner-circle-bg",
          "left-[calc(4px*var(--resolution-factor))]",
          "top-[calc(4px*var(--resolution-factor))]",
          "w-[calc(111px*var(--resolution-factor))]",
          "h-[calc(111px*var(--resolution-factor))]",
          "border-[calc(15.5px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute rounded-full box-border border-main-banner-circle-border",
          "left-[calc(19.5px*var(--resolution-factor))]",
          "top-[calc(19.5px*var(--resolution-factor))]",
          "w-[calc(80px*var(--resolution-factor))]",
          "h-[calc(80px*var(--resolution-factor))]",
          "border-[calc(3px*var(--resolution-factor))]",
        )}
      />
      <svg
        className={cn(
          "absolute pointer-events-none",
          "left-[calc(3px*var(--resolution-factor))]",
          "top-[calc(3px*var(--resolution-factor))]",
          "w-[calc(113px*var(--resolution-factor))]",
          "h-[calc(113px*var(--resolution-factor))]",
        )}
        viewBox="0 0 113 113"
        fill="none"
        role="presentation"
        imageRendering="optimizeQuality"
      >
        <defs>
          <mask id={maskId}>
            <circle cx="56.5" cy="56.5" r="55.5" fill="white" />
            <circle cx="56.5" cy="56.5" r="40" fill="black" />
          </mask>
        </defs>
        {fill > 0 && (
          <path
            d={circleRingArc(fill, 56.5, 56.5, 39, 56)}
            fill={fillColor}
            mask={`url(#${maskId})`}
          />
        )}
        <g mask={`url(#${maskId})`} stroke="white" strokeWidth="1">
          <line x1="0.5" y1="56.5" x2="112.5" y2="56.5" />
          <line x1="56.5" y1="0.5" x2="56.5" y2="112.5" />
          <line x1="16.9" y1="16.9" x2="96.1" y2="96.1" />
          <line x1="16.9" y1="96.1" x2="96.1" y2="16.9" />
        </g>
      </svg>
      <div
        className={cn(
          "absolute rounded-full overflow-hidden",
          !hasChildren && "bg-main-banner-circle-viewport",
          "left-0 top-0",
          "w-[calc(119px*var(--resolution-factor))]",
          "h-[calc(119px*var(--resolution-factor))]",
          isExpanded
            ? "[clip-path:circle(calc(55.5px*var(--resolution-factor)))] [transition:clip-path_150ms_ease-out]"
            : "[clip-path:circle(calc(37px*var(--resolution-factor)))] [transition:clip-path_150ms_ease-out_400ms]",
        )}
      >
        {renderedChildren}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 pointer-events-auto [clip-path:circle(calc(37px*var(--resolution-factor)))] bg-transparent border-none p-0 cursor-default"
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      />
    </div>
  );
}

const HEART_PATH =
  "M6.7 -17.9L13 -18.15Q20 -15.5 20.7 -9.2Q21.4 -3.3 18 1.95Q14.7 7.1 10.05 11.4Q5.7 15.35 0.5 18.55L-0.5 18.55Q-5.75 15.35 -10.1 11.4Q-14.75 7.1 -18.05 2Q-21.4 -3.25 -20.7 -9.2Q-20 -15.45 -13 -18.1L-6.75 -17.8L-0.45 -15.25L0.55 -15.25L6.7 -17.9";

type HeartDisplayState = "value" | "double" | "percent";

const HEART_DISPLAY_CYCLE: HeartDisplayState[] = ["value", "double", "percent"];

function MainBannerHeart({
  className,
  hp = 100,
  max = 100,
  children,
}: {
  className?: string;
  hp?: number;
  max?: number;
  children?: ReactNode;
}) {
  const clipId = useId();
  const mode = useBannerMode();
  const circleExpanded = useCircleExpanded();
  const shiftUp = mode === "normal" && circleExpanded;
  const [displayState, setDisplayState] = useState<HeartDisplayState>("value");
  const fillY = 19.55 - (hp / max) * 39.1;

  function toggleDisplay() {
    setDisplayState((prev) => {
      const idx = HEART_DISPLAY_CYCLE.indexOf(prev);

      return HEART_DISPLAY_CYCLE[(idx + 1) % HEART_DISPLAY_CYCLE.length];
    });
  }

  return (
    <button
      type="button"
      className={cn(
        "absolute z-10 cursor-pointer border-none bg-transparent p-0",
        "left-[calc(395.2px*var(--resolution-factor))]",
        "top-[calc(-4.5px*var(--resolution-factor))]",
        "w-[calc(43.6px*var(--resolution-factor))]",
        "h-[calc(39.1px*var(--resolution-factor))]",
        "translate-y-0 [transition:translate_300ms_ease-out_400ms]",
        shiftUp &&
          "-translate-y-[calc(30px*var(--resolution-factor))] [transition:translate_150ms_ease-out]",
        className,
      )}
      onClick={toggleDisplay}
    >
      <svg
        className="w-full h-full"
        viewBox="-21.8 -19.55 43.6 39.1"
        fill="none"
        role="presentation"
        shapeRendering="geometricPrecision"
        imageRendering="optimizeQuality"
      >
        <path d={HEART_PATH} fill="#ffff66" />
        <defs>
          <clipPath id={clipId}>
            <path d={HEART_PATH} />
          </clipPath>
        </defs>
        <rect
          x="-22"
          y={fillY}
          width="44"
          height={39.1}
          fill="#d80101"
          clipPath={`url(#${clipId})`}
        />
        <path
          d={HEART_PATH}
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="4.8" cy="-8.8" r="3" fill="white" fillOpacity="0.3" />
        <ellipse
          cx="-11.7"
          cy="-5.9"
          rx="5.7"
          ry="5.8"
          fill="white"
          fillOpacity="0.3"
        />
        <path
          d="M9.6 -16.4L7.6 -16.75Q10.5 -17.55 12.8 -16.8Q19.3 -14.35 19.95 -8.5Q20.55 -3 17.45 1.9Q14.35 6.65 10.05 10.65Q6 14.35 1.15 17.3L0.25 17.3Q-4.65 14.35 -8.7 10.65Q-13 6.65 -16.05 1.9Q-17.25 0.05 -17.9 -1.85L-16.6 0.6Q-13.85 4.9 -9.9 8.5Q-6.2 11.9 -1.8 14.6L-0.95 14.6Q3.45 11.9 7.15 8.5Q11.05 4.9 13.85 0.55Q16.7 -3.85 16.15 -8.85Q15.5 -14.2 9.6 -16.4"
          fill="#660000"
          fillOpacity="0.32"
        />
        {match(displayState)
          .with("value", () => (
            <text
              x="0"
              y="-2.775"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="Impact"
              fontSize="18"
              fill="#000033"
            >
              {hp}
            </text>
          ))
          .with("double", () => (
            <>
              <text
                x="0"
                y="-6.675"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="Impact"
                fontSize="16"
                fill="#000033"
              >
                {hp}
              </text>
              <text
                x="0"
                y="6.575"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="Impact"
                fontSize="13"
                fill="#000066"
              >
                {max}
              </text>
            </>
          ))
          .with("percent", () => (
            <>
              <text
                x="0"
                y="-6.675"
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="Impact"
                fontSize="16"
                fill="#000033"
              >
                {Math.ceil((hp / max) * 100)}
              </text>
              <PercentSign transform="translate(0, -1)" />
            </>
          ))
          .exhaustive()}
      </svg>
      {children}
    </button>
  );
}

const BUTTON_POSITIONS = [
  476, 505.25, 534.5, 563.75, 593, 622.25, 651.5, 680.75, 710,
];

function MainBannerButtons({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const childArray = Array.isArray(children)
    ? children
    : children
      ? [children]
      : [];

  return (
    <div className={cn("absolute", className)}>
      {childArray.map((child, i) => (
        <div
          key={BUTTON_POSITIONS[i] ?? i}
          className="absolute"
          style={{
            left: `calc(${BUTTON_POSITIONS[i] ?? 476 + i * 29.25}px * var(--resolution-factor))`,
            top: "calc(8px * var(--resolution-factor))",
          }}
        >
          {child}
        </div>
      ))}
    </div>
  );
}

function MainBannerIconButton({
  className,
  icon,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: BannerIconName;
}) {
  const Icon = BANNER_ICONS[icon];

  return (
    <button
      type="button"
      className={cn(
        "group/btn relative cursor-pointer border-none bg-transparent p-0 overflow-visible",
        "w-[calc(24px*var(--resolution-factor))]",
        "h-[calc(24px*var(--resolution-factor))]",
        "[--ns-stroke:calc(1/var(--resolution-factor))]",
        className,
      )}
      {...props}
    >
      <ButtonBgUp className="absolute inset-0 w-full h-full pointer-events-none group-active/btn:hidden" />
      <ButtonBgDown className="absolute inset-0 w-full h-full pointer-events-none hidden group-active/btn:block" />
      <Icon className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none overflow-visible scale-(--resolution-factor) group-active/btn:translate-x-[calc(-50%+0.5px*var(--resolution-factor))] group-active/btn:translate-y-[calc(-50%+0.5px*var(--resolution-factor))]" />
    </button>
  );
}

const MORE_BUTTON_Y = [-140, -112, -84, -56, -28];

function MainBannerMorePanel({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const childArray = Array.isArray(children)
    ? children
    : children
      ? [children]
      : [];

  return (
    <>
      <div
        className={cn(
          "absolute",
          "left-[calc(710px*var(--resolution-factor))]",
          "top-[calc(8px*var(--resolution-factor))]",
        )}
      >
        <MainBannerIconButton
          icon={open ? "less" : "more"}
          onClick={() => setOpen((o) => !o)}
        />
      </div>
      {open && (
        <div
          className={cn(
            "absolute z-20 bottom-full",
            "left-[calc(704px*var(--resolution-factor))]",
            className,
          )}
        >
          <div
            className={cn(
              "relative bg-main-banner-bg",
              "border-x-[calc(2px*var(--resolution-factor))] border-t-[calc(2px*var(--resolution-factor))] border-main-banner-circle-border border-b-0",
              "rounded-t-[calc(10px*var(--resolution-factor))]",
              "flex flex-col items-center",
              "gap-[calc(2px*var(--resolution-factor))]",
              "px-[calc(3px*var(--resolution-factor))]",
              "pt-[calc(12px*var(--resolution-factor))]",
              "pb-[calc(2px*var(--resolution-factor))]",
            )}
          >
            {childArray.map((child, i) => (
              <div key={MORE_BUTTON_Y[i] ?? i}>{child}</div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function MainBannerRightPanel({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute bg-main-banner-panel-bg overflow-hidden",
        "left-[calc(464.1px*var(--resolution-factor))]",
        "top-[calc(49px*var(--resolution-factor))]",
        "w-[calc(252px*var(--resolution-factor))]",
        "h-[calc(64px*var(--resolution-factor))]",
        "[clip-path:polygon(0%_0.3%,78.3%_0.08%,84.9%_0.08%,100%_0%,100%_100%,21.2%_100%,19.8%_97.7%,19.3%_93.1%,19.2%_54.4%,0%_54.7%)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MainBannerTurnButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "group/turn absolute z-10 cursor-pointer border-none bg-transparent p-0 overflow-visible",
        "left-[calc(463px*var(--resolution-factor))]",
        "top-[calc(89.2px*var(--resolution-factor))]",
        "w-[calc(41px*var(--resolution-factor))]",
        "h-[calc(24px*var(--resolution-factor))]",
        className,
      )}
      {...props}
    >
      <TurnButtonUp className="absolute inset-0 w-full h-full pointer-events-none group-active/turn:opacity-0" />
      <TurnButtonDown className="absolute inset-0 w-full h-full pointer-events-none opacity-0 group-active/turn:opacity-100" />
    </button>
  );
}

function MainBannerGridSlot({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "relative",
        "w-[calc(25px*var(--resolution-factor))]",
        "h-[calc(25px*var(--resolution-factor))]",
        "bg-[#beb998] border-none",
        "shadow-[inset_calc(1px*var(--resolution-factor))_calc(1px*var(--resolution-factor))_0_0_#877b63,inset_calc(-1px*var(--resolution-factor))_calc(-1px*var(--resolution-factor))_0_0_#d1ccb6]",
        "hover:shadow-[inset_0_0_0_calc(2px*var(--resolution-factor))_#ff6600]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function MainBannerGridTab({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Tabs.Tab>) {
  return (
    <Tabs.Tab
      className={cn(
        "cursor-pointer p-0 m-0 border-none",
        "w-[calc(15px*var(--resolution-factor))]",
        "h-[calc(32px*var(--resolution-factor))]",
        "text-[calc(10px*var(--resolution-factor))]",
        "font-[Verdana,sans-serif]",
        "[writing-mode:vertical-rl] [text-orientation:mixed]",
        "bg-[#514A3C] text-white font-normal",
        "aria-selected:w-[calc(16px*var(--resolution-factor))] aria-selected:pr-[calc(1px*var(--resolution-factor))] aria-selected:bg-[linear-gradient(to_right,#B4AC8D_70%,#9a9378)] aria-selected:text-[#514A3C] aria-selected:font-bold",
        className,
      )}
      {...props}
    >
      {children}
    </Tabs.Tab>
  );
}

function MainBannerGrid({
  className,
  children,
  tabs,
  defaultValue,
}: {
  className?: string;
  children?: ReactNode;
  tabs?: { value: string; label: string }[];
  defaultValue?: string;
}) {
  return (
    <Tabs.Root
      defaultValue={defaultValue ?? tabs?.[0]?.value}
      className={cn(
        "absolute",
        "left-[calc(464.1px*var(--resolution-factor))]",
        "top-[calc(41px*var(--resolution-factor))]",
        "w-[calc(252px*var(--resolution-factor))]",
        "h-[calc(88px*var(--resolution-factor))]",
        className,
      )}
    >
      <div
        className={cn(
          "absolute grid grid-cols-[repeat(7,auto)]",
          "left-[calc(54px*var(--resolution-factor))]",
          "top-[calc(13px*var(--resolution-factor))]",
          "gap-x-[calc(3px*var(--resolution-factor))]",
          "gap-y-[calc(4px*var(--resolution-factor))]",
        )}
      >
        {children}
      </div>
      {tabs && (
        <Tabs.List
          className={cn(
            "absolute flex flex-col",
            "left-full",
            "top-[calc(8.1px*var(--resolution-factor))]",
          )}
        >
          {tabs.map(({ value, label }) => (
            <MainBannerGridTab key={value} value={value}>
              {label}
            </MainBannerGridTab>
          ))}
        </Tabs.List>
      )}
    </Tabs.Root>
  );
}

function MainBannerFightControls({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const mode = useBannerMode();

  if (mode !== "fight") {
    return null;
  }

  return (
    <div
      className={cn(
        "absolute flex items-center",
        "left-[calc(395.5px*var(--resolution-factor))]",
        "top-[calc(88px*var(--resolution-factor))]",
        "gap-[calc(4px*var(--resolution-factor))]",
        "h-[calc(24px*var(--resolution-factor))]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export {
  MainBanner,
  MainBannerButtons,
  MainBannerChat,
  MainBannerChatInput,
  MainBannerCircle,
  MainBannerFightControls,
  MainBannerGrid,
  MainBannerGridSlot,
  MainBannerGridTab,
  MainBannerHeart,
  MainBannerIconButton,
  MainBannerMorePanel,
  MainBannerRightPanel,
  MainBannerTurnButton,
};
