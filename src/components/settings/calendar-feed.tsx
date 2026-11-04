"use client";

import { CalendarPlus, Copy, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/misc";
import { useUpdateProfile } from "@/lib/queries/profile";
import type { Profile } from "@/lib/types";

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Private iCalendar feed of tasks + reminders for Google / Apple / Outlook calendars. */
export function CalendarFeed({ profile }: { profile: Profile }) {
  const update = useUpdateProfile();
  const token = profile.calendar_token;
  const httpsUrl = token ? `${window.location.origin}/api/calendar/${token}.ics` : "";
  const webcal = httpsUrl.replace(/^https?:/, "webcal:");

  if (!token) {
    return (
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1 text-[13px] text-fg-2">
          See your tasks and reminders in Google Calendar, Apple Calendar or Outlook. Read-only, refreshed by your calendar app (Google: every few hours).
        </div>
        <Button variant="primary" onClick={() => update.mutate({ calendar_token: newToken() })}>
          <CalendarPlus className="h-4 w-4" /> Create calendar link
        </Button>
      </Card>
    );
  }
  return (
    <Card className="space-y-3 p-4">
      <div className="flex gap-2">
        <input readOnly value={httpsUrl} className="field font-mono text-[12px]" onFocus={(e) => e.currentTarget.select()} />
        <Button onClick={() => navigator.clipboard.writeText(httpsUrl).then(() => toast.success("Link copied"))}>
          <Copy className="h-3.5 w-3.5" /> Copy
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noreferrer">
          <Button size="sm" variant="secondary">Add to Google Calendar</Button>
        </a>
        <a href={webcal}>
          <Button size="sm" variant="secondary">Open in Apple / Outlook</Button>
        </a>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => update.mutate({ calendar_token: newToken() }, { onSuccess: () => toast("New link created — the old one stopped working") })}
        >
          <RefreshCw className="h-3.5 w-3.5" /> New link
        </Button>
        <Button size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={() => update.mutate({ calendar_token: null })}>
          <Trash2 className="h-3.5 w-3.5" /> Turn off
        </Button>
      </div>
      <p className="text-[11.5px] text-faint">Anyone with this link can see your task titles. Keep it private; make a new link if it leaks.</p>
    </Card>
  );
}
