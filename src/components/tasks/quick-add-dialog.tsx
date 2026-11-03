"use client";

import { useUi } from "@/components/shell/ui-store";
import { Dialog } from "@/components/ui/dialog";
import { useToday } from "@/lib/hooks";
import { QuickAdd } from "./quick-add";

export function QuickAddDialog() {
  const { quickAdd, closeQuickAdd } = useUi();
  const today = useToday();
  return (
    <Dialog open={!!quickAdd} onOpenChange={(o) => !o && closeQuickAdd()} title="New task" size="md">
      <QuickAdd
        autoFocus
        defaultDate={quickAdd?.due_date === undefined ? today : quickAdd.due_date}
        onDone={closeQuickAdd}
      />
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
        <span>
          <span className="text-fg-2">tomorrow 6pm</span> · date &amp; time
        </span>
        <span>
          <span className="text-fg-2">every monday</span> · repeat
        </span>
        <span>
          <span className="text-fg-2">p1</span> · priority
        </span>
        <span>
          <span className="text-fg-2">#jobs</span> · tag
        </span>
        <span>
          <span className="text-fg-2">~30m</span> · estimate
        </span>
      </div>
    </Dialog>
  );
}
