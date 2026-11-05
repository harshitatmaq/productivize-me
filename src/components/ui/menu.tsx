"use client";

import { DropdownMenu as M, Popover as P, Tooltip as T } from "radix-ui";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

const panel =
  "z-50 min-w-44 overflow-hidden rounded-xl border border-line-strong bg-panel p-1 text-[13px] shadow-pop data-[state=open]:animate-fade-in";

const tipClass =
  "z-50 rounded-md border border-line-strong bg-panel px-2 py-1 text-[12px] text-fg-2 shadow-pop data-[state=delayed-open]:animate-fade-in data-[state=instant-open]:animate-fade-in";

/**
 * `label` adds a hover/focus tooltip to the trigger (use it for icon-only triggers,
 * together with an aria-label on the button).
 */
export function Menu({
  trigger,
  children,
  align = "end",
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
  label?: ReactNode;
}) {
  return (
    <M.Root modal={false}>
      {label ? (
        <T.Root delayDuration={350}>
          <T.Trigger asChild data-tip="">
            <M.Trigger asChild>{trigger}</M.Trigger>
          </T.Trigger>
          <T.Portal>
            <T.Content side="top" sideOffset={6} className={tipClass}>
              {label}
            </T.Content>
          </T.Portal>
        </T.Root>
      ) : (
        <M.Trigger asChild>{trigger}</M.Trigger>
      )}
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
  label,
}: {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (o: boolean) => void;
  align?: "start" | "end" | "center";
  className?: string;
  /** Hover/focus tooltip for an icon-only trigger. */
  label?: ReactNode;
}) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      {label ? (
        <T.Root delayDuration={350}>
          <T.Trigger asChild data-tip="">
            <P.Trigger asChild>{trigger}</P.Trigger>
          </T.Trigger>
          <T.Portal>
            <T.Content side="bottom" sideOffset={6} className={tipClass}>
              {label}
            </T.Content>
          </T.Portal>
        </T.Root>
      ) : (
        <P.Trigger asChild>{trigger}</P.Trigger>
      )}
      <P.Portal>
        <P.Content align={align} sideOffset={6} className={cn(panel, "p-3", className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/**
 * Label for an icon (or anything that needs explaining): shows on hover and
 * keyboard focus, and on phones on a long-press (which then doesn't also tap).
 */
export function Tip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const clear = () => window.clearTimeout(timer.current);
  return (
    <T.Root delayDuration={350} open={open} onOpenChange={setOpen}>
      <T.Trigger
        asChild
        data-tip=""
        onPointerDown={(e) => {
          if (e.pointerType !== "touch") return;
          longPressed.current = false;
          clear();
          timer.current = window.setTimeout(() => {
            longPressed.current = true;
            setOpen(true);
            navigator.vibrate?.(8);
          }, 450);
        }}
        onPointerUp={() => {
          clear();
          if (longPressed.current) timer.current = window.setTimeout(() => setOpen(false), 1600);
        }}
        onPointerCancel={clear}
        onClickCapture={(e) => {
          // The long-press only showed the label; don't also press the button.
          if (longPressed.current) {
            e.preventDefault();
            e.stopPropagation();
            longPressed.current = false;
          }
        }}
        onContextMenu={(e) => {
          if (longPressed.current) e.preventDefault();
        }}
      >
        {children}
      </T.Trigger>
      <T.Portal>
        <T.Content side={side} sideOffset={6} className={tipClass}>
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}

export const TooltipProvider = T.Provider;
