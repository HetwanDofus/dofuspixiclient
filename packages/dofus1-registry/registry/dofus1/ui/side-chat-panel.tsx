"use client";

import type * as React from "react";
import {
  createContext,
  forwardRef,
  useContext,
  useId,
  useMemo,
  useRef,
} from "react";

import { cn } from "@/lib/utils";

import { SideChatArrowIcon } from "./icons/side-chat-panel/arrow";
import { SideChatSearchIcon } from "./icons/side-chat-panel/search";
import { SideChatTrashIcon } from "./icons/side-chat-panel/trash";
import { Scrollbar } from "./scrollbar";

type Side = "left" | "right";
type Theme = "light" | "dark";

interface SideChatPanelContextValue {
  side: Side;
  theme: Theme;
}

const SideChatPanelContext = createContext<SideChatPanelContextValue>({
  side: "right",
  theme: "light",
});

function useSideChatPanel() {
  return useContext(SideChatPanelContext);
}

// Hides the native webkit scrollbar so the decorative `<Scrollbar>` from the
// registry can overlay on top without doubling up.
const HIDE_NATIVE_SCROLLBAR = [
  "[scrollbar-width:none]",
  "[&::-webkit-scrollbar]:hidden",
  "[&::-webkit-scrollbar]:w-0",
];

interface SideChatPanelProps extends React.ComponentProps<"div"> {
  side?: Side;
  theme?: Theme;
}

function SideChatPanel({
  side = "right",
  theme = "light",
  className,
  children,
  ...props
}: SideChatPanelProps) {
  const ctx = useMemo(() => ({ side, theme }), [side, theme]);

  return (
    <SideChatPanelContext.Provider value={ctx}>
      <div
        data-side={side}
        data-theme={theme}
        className={cn(
          "flex flex-col w-full h-full select-none bg-side-chat-bg",
          // Pin the `<Scrollbar>` scaling inside the panel so scrollbar
          // arrows/track don't inherit the consumer app's viewport-based
          // `:root --resolution-factor`. The shared `<Scrollbar>` sizes
          // its 12 px geometry via `calc(12px * var(--resolution-factor))`.
          "[--resolution-factor:1.5]",
          // Game-facing divider — matches the `InfoLog`'s bottom separator
          // visually. Lives inside the panel via `box-sizing: border-box`
          // so the panel's overall width stays unchanged.
          side === "right"
            ? "border-l-4 border-l-side-chat-separator-bg"
            : "border-r-4 border-r-side-chat-separator-bg",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </SideChatPanelContext.Provider>
  );
}

function SideChatPanelFilters({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-row items-center shrink-0",
        // Matches the original table layout: each <td> has padding: 5px
        // on all sides, producing 10 px horizontal gap between cells and
        // 5 px vertical breathing above/below the 29 px checkbox, for a
        // 39 px total row height.
        "gap-2.5 py-1.25 px-1.25 bg-side-chat-filters-bg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function SideChatPanelFilterGroup({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // `flex-wrap` lets filters break onto a second row when the header
        // is narrower than the filter list — the filters row (parent)
        // then grows in height instead of overflowing horizontally.
        "flex flex-row flex-wrap items-center flex-1 gap-1",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface SideChatPanelFilterProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "color"> {
  color?: string;
  label?: string;
}

const SideChatPanelFilter = forwardRef<
  HTMLInputElement,
  SideChatPanelFilterProps
>(function SideChatPanelFilter(
  { color, label, className, id: idProp, style, ...props },
  ref
) {
  const autoId = useId();
  const id = idProp ?? autoId;

  return (
    <label
      className={cn(
        "inline-flex items-center justify-center relative cursor-pointer",
        className
      )}
      htmlFor={id}
      title={label}
    >
      <input
        {...props}
        ref={ref}
        id={id}
        type="checkbox"
        style={{
          ...(color ? { backgroundColor: color } : null),
          ...style,
        }}
        className={cn(
          "peer appearance-none cursor-pointer outline-none",
          "h-6 w-6 rounded-[3px]",
          "border-2 border-solid border-side-chat-filter-border",
          // Channel color, when set, lives on the inline `style` attribute
          // above; fall back to the black default class otherwise. The
          // original code used `color ?? "bg-..."` which injected the raw
          // hex string as a class name when `color` was provided.
          !color && "bg-side-chat-filter-bg"
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute block pointer-events-none",
          "text-[17px] leading-normal font-[Verdana,sans-serif]",
          "text-side-chat-filter-check",
          "opacity-0 peer-checked:opacity-100"
        )}
      >
        {"\u2714\uFE0E"}
      </span>
    </label>
  );
});

type SideChatPanelActionButtonProps =
  React.ButtonHTMLAttributes<HTMLButtonElement>;

function SideChatPanelActionButton({
  className,
  children,
  ...props
}: SideChatPanelActionButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        "min-w-5 px-1.75 py-0.75",
        "bg-side-chat-action-bg border-0 rounded-[5px] cursor-pointer",
        "text-side-chat-action-fg",
        "[&>svg]:w-5.25 [&>svg]:h-5.25",
        "[&>img]:w-5.25 [&>img]:h-5.25",
        className
      )}
    >
      {children}
    </button>
  );
}

interface SideChatPanelMovePanelButtonProps
  extends Omit<SideChatPanelActionButtonProps, "onClick"> {
  onMove?: (next: Side) => void;
}

function SideChatPanelMovePanelButton({
  className,
  onMove,
  ...props
}: SideChatPanelMovePanelButtonProps) {
  const { side } = useSideChatPanel();
  const targetSide: Side = side === "right" ? "left" : "right";

  return (
    <SideChatPanelActionButton
      aria-label={`Move panel to ${targetSide}`}
      onClick={() => onMove?.(targetSide)}
      className={className}
      {...props}
    >
      <SideChatArrowIcon direction={targetSide} />
    </SideChatPanelActionButton>
  );
}

type SideChatPanelLogProps = React.ComponentProps<"div">;

function SideChatPanelLog({
  className,
  children,
  ...props
}: SideChatPanelLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn(
        "relative flex-1 min-h-0 bg-side-chat-log-outer-bg p-0 m-0",
        className
      )}
    >
      <div
        ref={scrollRef}
        className={cn(
          "w-full h-full overflow-y-auto bg-side-chat-log-inner-bg m-0 p-0",
          HIDE_NATIVE_SCROLLBAR
        )}
        {...props}
      >
        <div
          className={cn(
            "font-[Verdana,sans-serif] text-[15px] leading-[1.2]",
            "wrap-break-word whitespace-break-spaces",
            "border-t-10 border-b-10 border-l-[5px] border-r-[5px] border-solid",
            "border-side-chat-border m-0 p-0",
            // Reserve the scrollbar's horizontal footprint so text lines
            // don't slide under the overlaid `<Scrollbar>` on the right.
            "pr-[calc(12px*var(--resolution-factor))]",
            "*:m-0 *:p-0"
          )}
        >
          {children}
        </div>
      </div>
      <Scrollbar
        axis="vertical"
        scrollTarget={scrollRef}
        className="bg-side-chat-bg absolute top-0 bottom-0 right-0"
      />
    </div>
  );
}

function SideChatPanelInfoLog({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  const scrollRef = useRef<HTMLDivElement>(null);

  return (
    <div
      className={cn(
        "relative shrink-0 bg-side-chat-log-outer-bg p-0 m-0",
        "border-b-4 border-b-side-chat-separator-bg",
        className
      )}
    >
      <div
        ref={scrollRef}
        className={cn(
          "w-full h-full overflow-y-auto bg-side-chat-log-inner-bg m-0 p-0",
          HIDE_NATIVE_SCROLLBAR
        )}
        {...props}
      >
        <div
          className={cn(
            "font-[Verdana,sans-serif] text-[15px] leading-[1.2]",
            "wrap-break-word whitespace-break-spaces",
            "border-t-10 border-b-10 border-l-[5px] border-r-[5px] border-solid",
            "border-side-chat-border m-0 p-0",
            // Reserve the scrollbar's horizontal footprint so text lines
            // don't slide under the overlaid `<Scrollbar>` on the right.
            "pr-[calc(12px*var(--resolution-factor))]",
            "*:m-0 *:p-0"
          )}
        >
          {children}
        </div>
      </div>
      <Scrollbar
        axis="vertical"
        scrollTarget={scrollRef}
        className="bg-side-chat-bg absolute top-0 bottom-0 right-0"
      />
    </div>
  );
}

type SideChatPanelInputRowProps = React.ComponentProps<"div">;

function SideChatPanelInputRow({
  className,
  children,
  ...props
}: SideChatPanelInputRowProps) {
  return (
    <div
      className={cn(
        "flex flex-row items-center shrink-0 gap-1.25",
        "p-1 bg-side-chat-bg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface SideChatPanelPrefixButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  prefix?: string;
}

const SideChatPanelPrefixButton = forwardRef<
  HTMLButtonElement,
  SideChatPanelPrefixButtonProps
>(function SideChatPanelPrefixButton(
  { className, prefix, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center justify-center shrink-0",
        "w-[3em] h-8.75 px-1.75 py-1.75",
        "bg-side-chat-action-bg border-0 rounded-[5px] cursor-pointer",
        "font-bitmini6 text-[14px] text-black",
        className
      )}
    >
      {children ?? <span>{prefix}</span>}
    </button>
  );
});

interface SideChatPanelFunctionKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  currentPrompt: string;
}

interface SideChatPanelTextInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onSubmit"> {
  onSubmit?: (value: string) => void;
  onFunctionKey?: (event: SideChatPanelFunctionKeyEvent) => void;
  submitKeys?: readonly string[];
  functionKeys?: readonly string[];
}

const DEFAULT_SUBMIT_KEYS: readonly string[] = ["Enter", "NumpadEnter"];

// Mirrors Retro `onRetroChatFunctionKey` keycodes via `KeyboardEvent.code`:
// Tab(9), PageUp(33), PageDown(34), ArrowUp(38), ArrowDown(40).
const DEFAULT_FUNCTION_KEYS: readonly string[] = [
  "Tab",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
];

const SideChatPanelTextInput = forwardRef<
  HTMLInputElement,
  SideChatPanelTextInputProps
>(function SideChatPanelTextInput(
  {
    className,
    onSubmit,
    onFunctionKey,
    onKeyDown,
    submitKeys = DEFAULT_SUBMIT_KEYS,
    functionKeys = DEFAULT_FUNCTION_KEYS,
    ...props
  },
  ref
) {
  return (
    <input
      ref={ref}
      type="text"
      {...props}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) {
          return;
        }

        const target = e.currentTarget;
        const id = e.code || e.key;

        if (submitKeys.includes(id) || submitKeys.includes(e.key)) {
          onSubmit?.(target.value);
          return;
        }

        if (functionKeys.includes(id) || functionKeys.includes(e.key)) {
          onFunctionKey?.({
            key: e.key,
            code: e.code,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            altKey: e.altKey,
            metaKey: e.metaKey,
            currentPrompt: target.value,
          });
        }
      }}
      className={cn(
        "block flex-1 min-w-0 h-8.75 m-auto outline-none",
        "bg-side-chat-input-bg font-[sans-serif] text-black",
        "rounded-sm px-2",
        "focus:outline-none",
        className
      )}
    />
  );
});

interface SideChatPanelMessageProps extends React.ComponentProps<"div"> {
  color?: string;
  /** Zero-padded `HH:MM` timestamp. Omit for info messages. */
  time?: string;
  /** Channel label rendered in parens. Omit for info messages. */
  channel?: string;
  /** Player name rendered in bold. Omit for info messages. */
  player?: string;
}

/**
 * Chat entries follow `[HH:MM] (channel) **PlayerName** : text` — time,
 * channel, and bolded player are optional so info-log entries render as
 * plain text. Structured parts render only when their prop is set; the
 * `:` separator appears whenever any of them is present.
 */
function SideChatPanelMessage({
  className,
  color,
  time,
  channel,
  player,
  children,
  ...props
}: SideChatPanelMessageProps) {
  const hasPrefix = Boolean(time || channel || player);

  return (
    <div
      className={cn(
        "retroChatMessage",
        // MDX wraps multi-line children in `<p>`, which is block-level and
        // forces a newline before the text. Force any descendant `<p>` to
        // render inline so the message stays on one (wrapping) line.
        "[&_p]:inline [&_p]:m-0 [&_p]:p-0",
        className
      )}
      style={color ? { color } : undefined}
      {...props}
    >
      {time ? `[${time}] ` : null}
      {channel ? `(${channel}) ` : null}
      {player ? <span className="font-bold">{player}</span> : null}
      {hasPrefix ? " : " : null}
      {children}
    </div>
  );
}

export type {
  Side as SideChatPanelSide,
  SideChatPanelActionButtonProps,
  SideChatPanelFilterProps,
  SideChatPanelFunctionKeyEvent,
  SideChatPanelMessageProps,
  SideChatPanelMovePanelButtonProps,
  SideChatPanelPrefixButtonProps,
  SideChatPanelProps,
  SideChatPanelTextInputProps,
  Theme as SideChatPanelTheme,
};
export {
  DEFAULT_FUNCTION_KEYS as SIDE_CHAT_PANEL_DEFAULT_FUNCTION_KEYS,
  DEFAULT_SUBMIT_KEYS as SIDE_CHAT_PANEL_DEFAULT_SUBMIT_KEYS,
  SideChatArrowIcon,
  SideChatPanel,
  SideChatPanelActionButton,
  SideChatPanelFilter,
  SideChatPanelFilterGroup,
  SideChatPanelFilters,
  SideChatPanelInfoLog,
  SideChatPanelInputRow,
  SideChatPanelLog,
  SideChatPanelMessage,
  SideChatPanelMovePanelButton,
  SideChatPanelPrefixButton,
  SideChatPanelTextInput,
  SideChatSearchIcon,
  SideChatTrashIcon,
};
