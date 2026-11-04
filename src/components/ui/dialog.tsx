"use client";

import { Dialog as D } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
  size = "md",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const widths = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" };
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
        <D.Content
          className={cn(
            "fixed z-50 flex max-h-[92dvh] w-full flex-col overflow-hidden border border-line-strong bg-panel shadow-pop outline-none",
            // bottom sheet on phones, centred modal on larger screens
            "inset-x-0 bottom-0 rounded-t-2xl animate-[sheet-in_.25s_cubic-bezier(.2,.8,.2,1)]",
            "sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:rounded-2xl sm:animate-[pop-in_.18s_ease-out] sm:[transform:translate(-50%,-50%)]",
            widths[size],
            className,
          )}
          onOpenAutoFocus={(e) => {
            // keep phones from popping the keyboard unless a field asks for it
            if (window.matchMedia("(max-width: 640px)").matches) e.preventDefault();
          }}
        >
          <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-line-strong sm:hidden" />
          {title ? (
            <div className="flex items-start justify-between gap-3 border-b border-line px-5 pb-3 pt-4">
              <div className="min-w-0">
                <D.Title className="text-[15px] font-semibold text-fg">{title}</D.Title>
                {description ? <D.Description className="mt-0.5 text-[12.5px] text-muted">{description}</D.Description> : null}
              </div>
              <D.Close className="rounded-md p-1 text-muted hover:bg-panel-hover hover:text-fg" aria-label="Close">
                <X className="h-4 w-4" />
              </D.Close>
            </div>
          ) : (
            <D.Title className="sr-only">Dialog</D.Title>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-panel-2/50 px-5 py-3 safe-bottom">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
