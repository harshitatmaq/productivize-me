"use client";

import { Pencil } from "lucide-react";
import { Tip } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

/** One-click edit (no menu): a pencil next to an item's ⋯ menu. */
export function EditButton({ onClick, label = "Edit", className }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <Tip content={label}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        aria-label={label}
        className={cn("rounded-md p-1 text-faint transition-colors hover:bg-panel-hover hover:text-fg focus-visible:text-fg", className)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </Tip>
  );
}
