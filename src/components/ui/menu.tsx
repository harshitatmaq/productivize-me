"use client";

import { DropdownMenu as M, Popover as P, Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const panel =
  "z-50 min-w-44 overflow-hidden rounded-xl border border-line-strong bg-panel p-1 text-[13px] shadow-pop data-[state=open]:animate-fade-in";

export function Menu({ trigger, children, align = "end" }: { trigger: ReactNode; children: ReactNode; align?: "start" | "end" | "center" }) {
  return (
    <M.Root modal={false}>
      <M.Trigger asChild>{trigger}</M.Trigger>
      <M.Portal>
        <M.Content align={align} sideOffset={6} className={panel}>
          {children}
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  danger,
  shortcut,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  danger?: boolean;
  shortcut?: string;
  disabled?: boolean;
}) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-panel-hover",
        danger ? "text-danger" : "text-fg-2 data-[highlighted]:text-fg",
      )}
    >
      {icon ? <span className="flex h-4 w-4 items-center justify-center text-muted">{icon}</span> : null}
      <span className="flex-1">{children}</span>
      {shortcut ? <span className="text-[11px] text-faint">{shortcut}</span> : null}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-faint">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = "start",
  className,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: "start" | "end" | "center";
  className?: string;
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={6} className={cn(panel, "p-3", className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-fg-2 shadow-pop data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TooltipProvider = T.Provider;
