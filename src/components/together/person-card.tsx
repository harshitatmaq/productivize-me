"use client";

import { BellRing, CheckCircle2, Flame, GraduationCap, Hand, Send, Timer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { formatMinutes } from "@/components/tasks/task-utils";
import { Button } from "@/components/ui/button";
import { Card, ProgressRing } from "@/components/ui/misc";
import type { BuddyStats } from "@/lib/types";
import { api, cn, initials, timeAgo } from "@/lib/utils";

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel-2/50 p-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[20px] font-semibold tabular-nums text-fg">{value}</div>
      {sub ? <div className="text-[11.5px] text-faint">{sub}</div> : null}
    </div>
  );
}

export function PersonCard({ p }: { p: BuddyStats }) {
  const [sending, setSending] = useState<string | null>(null);
  const send = async (kind: "cheer" | "nudge") => {
    setSending(kind);
    try {
      await api("/api/buddy/nudge", { json: { to: p.user_id, kind } });
      toast.success(kind === "cheer" ? `Cheered ${p.name.split(" ")[0]} 👏` : `Nudged ${p.name.split(" ")[0]} ⏰`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(null);
    }
  };
  const todayTotal = p.tasks_done_today + p.tasks_open_today;
  return (
    <Card className={cn("p-5", p.is_me && "border-accent/30")}>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#8b93f5] to-[#5e6ad2] text-[13px] font-semibold text-white">
          {initials(p.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold text-fg">
            {p.name} {p.is_me ? <span className="text-[12px] font-normal text-faint">(you)</span> : null}
          </div>
          <div className="text-[12px] text-muted">{p.last_active ? `active ${timeAgo(p.last_active)}` : "no activity yet"}</div>
        </div>
        <ProgressRing value={todayTotal ? p.tasks_done_today / todayTotal : 0} size={42} stroke={4} color="var(--success)">
          <span className="text-[10.5px] font-semibold tabular-nums">
            {p.tasks_done_today}/{todayTotal}
          </span>
        </ProgressRing>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <Stat icon={<CheckCircle2 className="h-3.5 w-3.5 text-success" />} label="Tasks this week" value={p.tasks_done_week} />
        <Stat
          icon={<GraduationCap className="h-3.5 w-3.5 text-accent" />}
          label="Learning days"
          value={`${p.learning_days_week}/${p.learning_goal}`}
          sub={p.learning_days_week >= p.learning_goal ? "goal reached" : undefined}
        />
        <Stat icon={<Flame className="h-3.5 w-3.5 text-p2" />} label="Learning streak" value={`${p.learning_streak}d`} />
        <Stat icon={<Send className="h-3.5 w-3.5 text-p3" />} label="Applications" value={p.applications_week} sub="this week" />
        <div className="col-span-2">
          <Stat icon={<Timer className="h-3.5 w-3.5 text-warning" />} label="Focus" value={formatMinutes(p.focus_minutes_week)} sub="this week" />
        </div>
      </div>
      {!p.is_me ? (
        <div className="mt-4 flex gap-2">
          <Button className="flex-1" variant="secondary" onClick={() => send("cheer")} loading={sending === "cheer"}>
            <Hand className="h-4 w-4" /> Cheer
          </Button>
          <Button className="flex-1" variant="secondary" onClick={() => send("nudge")} loading={sending === "nudge"}>
            <BellRing className="h-4 w-4" /> Nudge
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

