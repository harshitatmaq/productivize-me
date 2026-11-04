"use client";

import { Bell, CheckCheck } from "lucide-react";
import Link from "next/link";
import { Popover } from "@/components/ui/menu";
import { useMarkNotificationsRead, useNotifications } from "@/lib/queries/notifications";
import { cn, timeAgo } from "@/lib/utils";
import { useState } from "react";

export function NotificationBell({ className }: { className?: string }) {
  const { data = [] } = useNotifications();
  const mark = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const unread = data.filter((n) => !n.read_at);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      className="w-[min(92vw,360px)] p-0"
      trigger={
        <button
          className={cn("relative rounded-md p-1.5 text-muted transition-colors hover:bg-panel-hover hover:text-fg", className)}
          aria-label={`Notifications${unread.length ? ` (${unread.length} unread)` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unread.length ? (
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-[var(--bg-elev)]" />
          ) : null}
        </button>
      }
    >
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-[13px] font-medium text-fg">Notifications</span>
        {unread.length ? (
          <button
            onClick={() => mark.mutate(unread.map((n) => n.id))}
            className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg"
          >
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </button>
        ) : null}
      </div>
      <div className="max-h-[60vh] overflow-y-auto p-1">
        {data.length === 0 ? (
          <div className="px-3 py-10 text-center text-[13px] text-muted">
            You&apos;re all caught up. Reminders, end-of-day reviews and job alerts land here.
          </div>
        ) : (
          data.map((n) => (
            <Link
              key={n.id}
              href={n.url ?? "/"}
              onClick={() => {
                if (!n.read_at) mark.mutate([n.id]);
                setOpen(false);
              }}
              className="flex gap-2.5 rounded-lg px-2.5 py-2 hover:bg-panel-hover"
            >
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-accent")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-fg">{n.title}</span>
                {n.body ? <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-[12px] text-muted">{n.body}</span> : null}
                <span className="mt-1 block text-[11px] text-faint">
                  {timeAgo(n.created_at)}
                  {n.channels.length ? ` · ${n.channels.join(", ")}` : ""}
                </span>
              </span>
            </Link>
          ))
        )}
      </div>
    </Popover>
  );
}
