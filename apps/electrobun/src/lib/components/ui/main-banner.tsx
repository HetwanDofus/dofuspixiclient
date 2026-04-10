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
const MainBannerContext = createContext<{ mode: BannerMode }>({
  mode: "normal",
});

function useBannerMode() {
  return useContext(MainBannerContext).mode;
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
  return (
    <MainBannerContext.Provider value={{ mode: mode ?? "normal" }}>
      <div
        className={cn(
          bannerVariants({ mode }),
          "w-[calc(742px*var(--resolution-factor))]",
          "h-[calc(124.985px*var(--resolution-factor))]",
          className,
        )}
      >
        <div
          className={cn(
            "absolute bg-main-banner-bg",
            "top-0",
            "w-[calc(742px*var(--resolution-factor))]",
            "h-[calc(124.985px*var(--resolution-factor))]",
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
            "h-[calc(21px*var(--resolution-factor))]",
          )}
        />
        {children}
      </div>
    </MainBannerContext.Provider>
  );
}

function MainBannerChat({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "absolute overflow-hidden",
        "left-[calc(0.5px*var(--resolution-factor))]",
        "top-[calc(1px*var(--resolution-factor))]",
        "w-[calc(412px*var(--resolution-factor))]",
        "h-[calc(103px*var(--resolution-factor))]",
        className,
      )}
    >
      {children}
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

function MainBannerCircle({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const mode = useBannerMode();
  const [expanded, setExpanded] = useState(false);
  const isExpanded = mode === "normal" && expanded;

  return (
    <div
      role="none"
      className={cn(
        "absolute z-10",
        "left-[calc(358px*var(--resolution-factor))]",
        "top-[calc(6px*var(--resolution-factor))]",
        "w-[calc(119px*var(--resolution-factor))]",
        "h-[calc(119px*var(--resolution-factor))]",
        className,
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
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
          "absolute rounded-full bg-main-banner-circle-border",
          "left-0 top-0",
          "w-[calc(119px*var(--resolution-factor))]",
          "h-[calc(119px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute rounded-full bg-main-banner-circle-bg",
          "left-[calc(4px*var(--resolution-factor))]",
          "top-[calc(4px*var(--resolution-factor))]",
          "w-[calc(111px*var(--resolution-factor))]",
          "h-[calc(111px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute rounded-full bg-main-banner-circle-border",
          "left-[calc(19.5px*var(--resolution-factor))]",
          "top-[calc(19.5px*var(--resolution-factor))]",
          "w-[calc(80px*var(--resolution-factor))]",
          "h-[calc(80px*var(--resolution-factor))]",
        )}
      />
      <div
        className={cn(
          "absolute rounded-full bg-main-banner-circle-viewport overflow-hidden transition-transform",
          "left-[calc(22.5px*var(--resolution-factor))]",
          "top-[calc(22.5px*var(--resolution-factor))]",
          "w-[calc(74px*var(--resolution-factor))]",
          "h-[calc(74px*var(--resolution-factor))]",
          isExpanded && "scale-125",
        )}
      >
        {children}
      </div>
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
        <line
          x1="0.5"
          y1="56.5"
          x2="112.5"
          y2="56.5"
          stroke="white"
          strokeWidth="1"
        />
        <line
          x1="56.5"
          y1="0.5"
          x2="56.5"
          y2="112.5"
          stroke="white"
          strokeWidth="1"
        />
      </svg>
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
            "left-[calc(703px*var(--resolution-factor))]",
            className,
          )}
        >
          <div
            className={cn(
              "relative bg-main-banner-bg",
              "border-x-[3px] border-t-[3px] border-main-banner-circle-border border-b-0",
              "rounded-t-[calc(10px*var(--resolution-factor))]",
              "flex flex-col items-center",
              "gap-[calc(4px*var(--resolution-factor))]",
              "px-[calc(5px*var(--resolution-factor))]",
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
        "w-[calc(16px*var(--resolution-factor))]",
        "h-[calc(31.5px*var(--resolution-factor))]",
        "text-[calc(9px*var(--resolution-factor))]",
        "font-[Verdana,sans-serif]",
        "[writing-mode:vertical-rl] [text-orientation:mixed]",
        "bg-[linear-gradient(to_right,#514A3C_70%,#3d3729)] text-white font-normal",
        "data-active:bg-[linear-gradient(to_right,#B4AC8D_70%,#9a9378)] data-active:text-[#514A3C] data-active:font-bold",
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
        "absolute flex items-start",
        "left-[calc(479.5px*var(--resolution-factor))]",
        "top-[calc(41px*var(--resolution-factor))]",
        "w-[calc(245px*var(--resolution-factor))]",
        "h-[calc(88px*var(--resolution-factor))]",
        "pl-[calc(38.6px*var(--resolution-factor))]",
        "pt-[calc(8px*var(--resolution-factor))]",
        "gap-[calc(3px*var(--resolution-factor))]",
        className,
      )}
    >
      <div
        className={cn(
          "grid grid-cols-[repeat(7,auto)]",
          "mt-[calc(5px*var(--resolution-factor))]",
          "gap-x-[calc(3px*var(--resolution-factor))]",
          "gap-y-[calc(4px*var(--resolution-factor))]",
        )}
      >
        {children}
      </div>
      {tabs && (
        <Tabs.List className="flex flex-col gap-[calc(1px*var(--resolution-factor))]">
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
  MainBannerHeart,
  MainBannerIconButton,
  MainBannerMorePanel,
  MainBannerRightPanel,
  MainBannerGrid,
  MainBannerGridSlot,
  MainBannerGridTab,
  MainBannerTurnButton,
};
