"use client";

import { useSyncExternalStore } from "react";

import { cn } from "@/lib/utils";

import { type ChatBubbleEntry, chatBubbleStore } from "./chat-bubble-store";

/**
 * Speech bubbles over speaking characters. Colours and geometry come from
 * `ank/battlefield/Constants.as:29-37`: background 0xFFFFCE, border 0x4B4B4B,
 * 10 px black text, 4 px padding, a 10x10 tail.
 */
export function ChatBubble() {
  const { entries } = useSyncExternalStore(
    chatBubbleStore.subscribe,
    chatBubbleStore.getSnapshot
  );

  if (entries.length === 0) {
    return null;
  }

  return (
    <>
      {entries.map((entry) => (
        <BubbleBox key={entry.id} entry={entry} />
      ))}
    </>
  );
}

function BubbleBox({ entry }: { entry: ChatBubbleEntry }) {
  return (
    <div
      role="presentation"
      className={cn(
        "pointer-events-none absolute select-none",
        "font-[Verdana,sans-serif] text-black",
        "text-[calc(10px*var(--resolution-factor,1))] leading-[1.25]",
        "max-w-[calc(220px*var(--resolution-factor,1))]"
      )}
      style={{
        left: entry.anchorX,
        top: entry.anchorY,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div
        className={cn(
          "border border-[#4b4b4b] bg-[#ffffce]",
          "px-[calc(4px*var(--resolution-factor,1))]",
          "py-[calc(3px*var(--resolution-factor,1))]",
          "whitespace-pre-wrap break-words text-center"
        )}
      >
        {entry.text}
      </div>
      {/*
        The tail. Retail draws it as part of the same fill, hanging off the
        bottom-left corner and pointing at the sprite's feet; a triangle with a
        matching border reproduces it without a second background layer.
      */}
      <svg
        className={cn(
          "absolute left-1/2 -translate-x-1/2",
          "w-[calc(10px*var(--resolution-factor,1))]",
          "h-[calc(10px*var(--resolution-factor,1))]"
        )}
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <path d="M0 0 L10 0 L0 10 Z" fill="#ffffce" stroke="none" />
        <path
          d="M0 0 L0 10 L10 0"
          fill="none"
          stroke="#4b4b4b"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}
