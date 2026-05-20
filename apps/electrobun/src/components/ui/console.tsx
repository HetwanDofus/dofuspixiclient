"use client";

import type * as React from "react";
import { createContext, forwardRef, useContext, useMemo } from "react";

import { cn } from "@/lib/utils";

type Size = "minimized" | "medium" | "max";

interface ConsoleContextValue {
  size: Size;
}

const ConsoleContext = createContext<ConsoleContextValue>({ size: "medium" });

function useConsole() {
  return useContext(ConsoleContext);
}

interface ConsoleProps extends React.ComponentProps<"div"> {
  size?: Size;
}

function Console({
  size = "medium",
  className,
  children,
  ...props
}: ConsoleProps) {
  const ctx = useMemo(() => ({ size }), [size]);

  return (
    <ConsoleContext.Provider value={ctx}>
      <div
        data-size={size}
        className={cn(
          // Outer rounded clip — `DebugLogsStylizedRectangle` rounds the top
          // 8 px and `DebugCommandLineStylizedRectangle` rounds the bottom
          // 8 px (DofusStylePackage.as:359-360). The middle seam between
          // logs and input is flat, which is exactly what overflow-hidden
          // gives us. Radius scales with resolution-factor so the curvature
          // stays proportional at any zoom.
          "relative flex flex-col select-none overflow-hidden",
          "w-[calc(702px*var(--resolution-factor))]",
          "rounded-[calc(8px*var(--resolution-factor))]",
          className
        )}
        {...props}
      >
        {children}
      </div>
    </ConsoleContext.Provider>
  );
}

function ConsoleButtons({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        // 20 px header row on the translucent black surface. No own
        // rounding — the outer `Console` clips. Buttons start at
        // widget-local x = 4 with a 20 px stride (Symbol 1153.xml:
        // _btnClose tx=24 vs widget origin tx=20 → 4; subsequent buttons
        // at 24, 44, 64 — i.e. stride 20). With 12-wide buttons that
        // means a `gap-8`.
        "flex flex-row items-center shrink-0",
        "h-[calc(20px*var(--resolution-factor))]",
        "pl-[calc(4px*var(--resolution-factor))]",
        "gap-[calc(8px*var(--resolution-factor))]",
        "bg-console-logs-bg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface ConsoleButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Single-character label rendered inside the pill — the FLA `UI_Debug`
   * (Symbol 1153.xml) ships "X" / "_" / "0" / "C" for close / minimize /
   * clear / copy. Override only if you want a custom glyph.
   */
  label?: string;
}

const ConsoleButton = forwardRef<HTMLButtonElement, ConsoleButtonProps>(
  function ConsoleButton({ className, label, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        {...props}
        className={cn(
          "inline-flex items-center justify-center shrink-0 cursor-pointer",
          // 12 × 12. Derived from Symbol 46's `boundingBox_mc` (Symbol 19
          // at d=0.18 → 100 × 18 natural) multiplied by the FLA matrix
          // scale (a=0.12, d=0.6667) on each `_btn*` placement:
          //   width  = 100 × 0.12     = 12
          //   height = 18  × 0.6667   = 12
          // Buttons are perfect 12 × 12 squares — not pills.
          "w-[calc(12px*var(--resolution-factor))]",
          "h-[calc(12px*var(--resolution-factor))]",
          // Subtle 2 px corner rounding matches the `ButtonFlatRoundDown`
          // skin (core.swf id 1728) when squashed from its 12 × 18 natural
          // height down to 12 × 12 — the 9-slice caps become rounded
          // squares, not full pills.
          "border-0 p-0 rounded-[calc(2px*var(--resolution-factor))]",
          // `WhiteCrossButton` (DofusStylePackage.as:94):
          //   bgcolor #ffffff → bgdowncolor #999999
          //   label flips `BlackCenterSmallLabel` → `BrownCenterSmallLabel`
          //   (#000000 → #514a3c).
          "bg-console-button-bg text-console-button-fg",
          "hover:bg-console-button-bg-active hover:text-console-button-fg-active",
          "active:bg-console-button-bg-active active:text-console-button-fg-active",
          // `BlackCenterSmallLabel` (DofusStylePackage.as:170):
          // Font1 (Verdana) size 10, non-bold, centered.
          "font-[Verdana,sans-serif] leading-none",
          "text-[calc(10px*var(--resolution-factor))]",
          "focus:outline-none",
          className
        )}
      >
        {children ?? label}
      </button>
    );
  }
);

function ConsoleCloseBtn({ label = "X", ...props }: ConsoleButtonProps) {
  return <ConsoleButton aria-label="Close console" label={label} {...props} />;
}

function ConsoleMinimizeBtn({ label = "_", ...props }: ConsoleButtonProps) {
  return (
    <ConsoleButton aria-label="Toggle console size" label={label} {...props} />
  );
}

function ConsoleClearBtn({ label = "0", ...props }: ConsoleButtonProps) {
  return (
    <ConsoleButton aria-label="Clear console logs" label={label} {...props} />
  );
}

function ConsoleCopyBtn({ label = "C", ...props }: ConsoleButtonProps) {
  return (
    <ConsoleButton aria-label="Copy console logs" label={label} {...props} />
  );
}

type ConsoleLogsAreaProps = React.ComponentProps<"div">;

function ConsoleLogsArea({
  className,
  children,
  ...props
}: ConsoleLogsAreaProps) {
  const { size } = useConsole();

  return (
    <div
      data-size={size}
      className={cn(
        // Scrollable text row underneath the header. Same translucent
        // black surface — no own rounding, the outer `Console` clips.
        // Heights mirror `Debug.maximize`/`minimize` (Debug.as:184-196):
        // 0 minimized, 200 medium, 370 max — matches `_cLogs.setSize`.
        "relative bg-console-logs-bg overflow-y-auto",
        "h-0 data-[size=medium]:h-[calc(200px*var(--resolution-factor))]",
        "data-[size=max]:h-[calc(370px*var(--resolution-factor))]",
        "data-[size=minimized]:overflow-hidden",
        // `ChatDebugScrollBar` (DofusStylePackage.as:44): transparent
        // track, white thumb, white arrows. Native scrollbar styling.
        "[scrollbar-width:thin] [scrollbar-color:#ffffff_transparent]",
        "[&::-webkit-scrollbar]:w-[calc(8px*var(--resolution-factor))]",
        "[&::-webkit-scrollbar-track]:bg-transparent",
        "[&::-webkit-scrollbar-thumb]:bg-white",
        // `_cLogs` sits at widget-local x = 0 (Symbol 1153.xml _cLogs
        // tx=20 vs widget origin tx=20 → 0). Tiny breathing room so
        // glyphs don't touch the outer rounded clip.
        "px-[calc(4px*var(--resolution-factor))]",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

type LogLevel = "default" | "error" | "info";

interface ConsoleLogLineProps extends React.ComponentProps<"div"> {
  /**
   * Semantic color channel — matches the three branches of
   * `Kernel.showMessage` that write into `aks_a_logs` (Kernel.as:407-429):
   *
   *   - `"default"` — `DEBUG_LOG`   → white (`#FFFFFF`) — normal info
   *   - `"error"`   — `DEBUG_ERROR` → red   (`#FF0000`)
   *   - `"info"`    — `DEBUG_INFO`  → green (`#00FF00`) — success
   *
   * The real game stores logs as a single HTML string with embedded
   * `<font color>` tags; this prop picks the equivalent token.
   */
  level?: LogLevel;
}

const LOG_LEVEL_CLASS: Record<LogLevel, string> = {
  default: "text-console-log-default",
  error: "text-console-log-error",
  info: "text-console-log-info",
};

function ConsoleLogLine({
  level = "default",
  className,
  children,
  ...props
}: ConsoleLogLineProps) {
  return (
    <div
      data-level={level}
      className={cn(
        // `_cLogs` instance overrides the default with
        // `styleName="ChatDebugTextArea"` (Symbol 1153.xml line 212) =
        // `_typewriter` size 11 (DofusStylePackage.as:38).
        "font-mono leading-[1.2]",
        "text-[calc(11px*var(--resolution-factor))]",
        // Flash `DropShadowFilter(d=1, a=60°, blur=3, strength=4)` reads
        // as a hard 1-px offset plus a soft halo.
        "[text-shadow:1px_1px_0_#000,0_0_2px_#000]",
        LOG_LEVEL_CLASS[level],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function ConsoleInputRow({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-row items-center shrink-0",
        // `_srCommandLineBack` is exactly 20 px tall
        // (Symbol 1153.xml: d=0.2 of its 100-tall placeholder).
        "h-[calc(20px*var(--resolution-factor))]",
        // `_lblPrompt` / `_tiCommandLine` start at widget-local x = 4.
        "pl-[calc(4px*var(--resolution-factor))]",
        "pr-[calc(4px*var(--resolution-factor))]",
        "gap-[calc(2px*var(--resolution-factor))]",
        // `DebugCommandLineStylizedRectangle` (DofusStylePackage.as:360).
        // No own rounding — the outer `Console` clips.
        "bg-console-input-bg",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

function ConsolePrompt({
  className,
  children,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        // `_lblPrompt` uses `BlackLeftDebugNoColorLabel` (Symbol 1153.xml
        // line 127) → `_typewriter` size 11, bold, color 0 (black).
        "shrink-0 font-mono font-bold text-console-prompt",
        "text-[calc(11px*var(--resolution-factor))] leading-none",
        className
      )}
      {...props}
    >
      {children}
      {" > "}
    </span>
  );
}

interface ConsoleFunctionKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  currentPrompt: string;
}

interface ConsoleInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onSubmit"> {
  onSubmit?: (value: string) => void;
  onFunctionKey?: (event: ConsoleFunctionKeyEvent) => void;
  submitKeys?: readonly string[];
  functionKeys?: readonly string[];
}

const DEFAULT_SUBMIT_KEYS: readonly string[] = ["Enter", "NumpadEnter"];

// `Debug.onShortcut` (Debug.as:241-260): AUTOCOMPLETE (Tab), HISTORY_UP
// (ArrowUp), HISTORY_DOWN (ArrowDown). Tab is `preventDefault`-ed so focus
// stays on the input even when no consumer listens.
const DEFAULT_FUNCTION_KEYS: readonly string[] = [
  "Tab",
  "ArrowUp",
  "ArrowDown",
];

const ConsoleInput = forwardRef<HTMLInputElement, ConsoleInputProps>(
  function ConsoleInput(
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
            // Tab would otherwise move focus out of the console — the
            // original Flash widget keeps caret here for autocomplete.
            e.preventDefault();
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
          "flex-1 min-w-0 bg-transparent outline-none border-0 p-0 m-0",
          // `_tiCommandLine` uses `BlackLeftDebugLabel` (Symbol 1153.xml
          // line 184) → `_typewriter` size 11, bold, color 0 (black).
          "font-mono font-bold text-console-prompt",
          "text-[calc(11px*var(--resolution-factor))] leading-none",
          "focus:outline-none",
          className
        )}
      />
    );
  }
);

export type {
  ConsoleButtonProps,
  ConsoleFunctionKeyEvent,
  ConsoleInputProps,
  ConsoleLogLineProps,
  ConsoleLogsAreaProps,
  ConsoleProps,
  LogLevel as ConsoleLogLevel,
  Size as ConsoleSize,
};
export {
  Console,
  ConsoleButton,
  ConsoleButtons,
  ConsoleClearBtn,
  ConsoleCloseBtn,
  ConsoleCopyBtn,
  ConsoleInput,
  ConsoleInputRow,
  ConsoleLogLine,
  ConsoleLogsArea,
  ConsoleMinimizeBtn,
  ConsolePrompt,
  DEFAULT_FUNCTION_KEYS as CONSOLE_DEFAULT_FUNCTION_KEYS,
  DEFAULT_SUBMIT_KEYS as CONSOLE_DEFAULT_SUBMIT_KEYS,
};
