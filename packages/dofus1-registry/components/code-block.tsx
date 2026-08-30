"use client";

import { Check, Copy } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

function CopyButton({
  preRef,
}: {
  preRef: React.RefObject<HTMLPreElement | null>;
}) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  return (
    <Button
      size="icon"
      variant="ghost"
      className="absolute top-2.5 right-2.5 size-7 opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity"
      onClick={async () => {
        const text = preRef.current?.textContent ?? "";
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }}
    >
      <span className="sr-only">Copy</span>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

export function CodeBlock(props: React.ComponentProps<"pre">) {
  const ref = React.useRef<HTMLPreElement>(null);

  return (
    <Card className="relative group mb-4 overflow-hidden">
      <CardContent className="p-0 [&_pre]:p-4 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_.line]:before:inline-block [&_.line]:before:w-8 [&_.line]:before:text-right [&_.line]:before:mr-4 [&_.line]:before:text-muted-foreground/40 [&_.line]:before:select-none [&_.line]:before:content-[counter(line)] [&_.line]:before:[counter-increment:line] [&_code]:[counter-reset:line]">
        <pre ref={ref} {...props} />
      </CardContent>
      <CopyButton preRef={ref} />
    </Card>
  );
}
