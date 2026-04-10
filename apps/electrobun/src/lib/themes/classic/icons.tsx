import type {
  IconProps,
  ThemeBannerIcons,
  ThemeBannerUtilityIcons,
} from "../types";

const BASE = "/themes/classic/assets/banner/icons";

function svgIcon(name: string, alt: string) {
  return function Icon({ style, className, ...rest }: IconProps) {
    return (
      <img
        src={`${BASE}/${name}.svg`}
        alt={alt}
        draggable={false}
        className={className}
        style={{ display: "block", width: "100%", height: "100%", ...style }}
        {...rest}
      />
    );
  };
}

export const bannerIcons: ThemeBannerIcons = {
  stats: svgIcon("stats", "Stats"),
  spells: svgIcon("spells", "Spells"),
  inventory: svgIcon("inventory", "Inventory"),
  quest: svgIcon("quest", "Quests"),
  map: svgIcon("map", "Map"),
  friends: svgIcon("friends", "Friends"),
  guild: svgIcon("guild", "Guild"),
  mount: svgIcon("mount", "Mount"),
  pvp: svgIcon("pvp", "PvP"),
};

export const bannerUtilityIcons: ThemeBannerUtilityIcons = {
  buttonUp: svgIcon("button-up", "Button"),
  buttonDown: svgIcon("button-down", "Button pressed"),
  expand: svgIcon("expand", "Expand"),
  reduce: svgIcon("reduce", "Reduce"),
  emotes: svgIcon("emotes", "Emotes"),
  emotesHover: svgIcon("emotes-hover", "Emotes"),
  sit: svgIcon("sit", "Sit"),
  sitHover: svgIcon("sit-hover", "Sit"),
};
