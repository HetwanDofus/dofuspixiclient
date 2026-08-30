import type * as React from "react";

import { cn } from "@/lib/utils";

function SideChatTrashIcon({
  className,
  ...props
}: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("w-5.25 h-5.25", className)}
      role="img"
      aria-label="Clear chat"
      {...props}
    >
      <title>Clear chat</title>
      <rect
        x="104.9"
        y="191.7"
        fill="var(--color-side-chat-trash-fill)"
        width="302.2"
        height="304.5"
      />
      <path
        fill="var(--color-side-chat-trash-stroke)"
        d="M180.1 413.4c-8.7 0-15.7-7-15.7-15.7V296.9c0-8.7 7-15.7 15.7-15.7s15.7 7 15.7 15.7v100.7c0 8.7-7 15.7-15.7 15.7zM256 413.4c-8.7 0-15.7-7-15.7-15.7V296.9c0-8.7 7-15.7 15.7-15.7s15.7 7 15.7 15.7v100.7c0 8.7-7 15.7-15.7 15.7zM331.9 413.4c-8.7 0-15.7-7-15.7-15.7V296.9c0-8.7 7-15.7 15.7-15.7s15.7 7 15.7 15.7v100.7c0 8.7-7 15.7-15.7 15.7zM395.9 73.7c-8.7 0-15.7 7-15.7 15.7s7 15.7 15.7 15.7c18.3 0 33.2 14.9 33.2 33.2v37.6H82.9v-37.6c0-18.3 14.9-33.2 33.2-33.2h163.5c8.7 0 15.7-7 15.7-15.7s-7-15.7-15.7-15.7h-92.9v-42.2h138.5v58c0 8.7 7 15.7 15.7 15.7s15.7-7 15.7-15.7V15.7C356.6 7 349.6 0 340.9 0H171c-8.7 0-15.7 7-15.7 15.7v58h-39.2c-35.7 0-64.7 29-64.7 64.7v53.4c0 8.7 7 15.7 15.7 15.7h22v288.8c0 8.7 7 15.7 15.7 15.7h302.2c8.7 0 15.7-7 15.7-15.7V207.5h22c8.7 0 15.7-7 15.7-15.7v-53.4c0-35.7-29-64.7-64.7-64.7zM391.3 480.5H120.7V207.5h270.7v273z"
      />
    </svg>
  );
}

export { SideChatTrashIcon };
