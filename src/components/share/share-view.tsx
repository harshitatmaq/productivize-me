"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Briefcase, CheckSquare, GraduationCap, Share2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, PageHeader } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { useCreateTask } from "@/lib/queries/tasks";
import type { Job } from "@/lib/types";
import { api, cn } from "@/lib/utils";

const JOB_HOSTS = /linkedin\.com\/jobs|naukri\.com|indeed\.|glassdoor\.|greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|wellfound\.com|instahyre\.com|cutshort\.io|foundit\.in|hirist\.|iimjobs\.com|workable\.com|smartrecruiters\.com|careers?\.|\/careers?\/|\/jobs?\//i;

/**
 * Target of the PWA share sheet (Android: Share → Productivize). Also works for
 * any link pasted as /share?url=…
 */
export function ShareView() {
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const today = useToday();
  const createTask = useCreateTask();
  const [busy, setBusy] = useState<string | null>(null);

  const title = params.get("title")?.trim() ?? "";
  const text = params.get("text")?.trim() ?? "";
  const url = useMemo(() => {
    const direct = params.get("url")?.trim();
    if (direct && /^https?:\/\//.test(direct)) return direct;
    return (text.match(/https?:\/\/\S+/) ?? [])[0]?.replace(/[)\].,]+$/, "") ?? "";
  }, [params, text]);
  const label = title || text.replace(url, "").trim() || url;
  const looksLikeJob = !!url && JOB_HOSTS.test(url);

  const saveJob = async () => {
    setBusy("job");
    try {
      const r = await api<{ job: Job; duplicate?: boolean; extracted: boolean }>("/api/jobs/import", { json: { url, text: `${title}\n${text}`, status: "saved" } });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(r.duplicate ? "Already saved" : `Saved: ${r.job.title}${r.job.score != null ? ` · ${r.job.score}% match` : ""}`);
      router.replace(`/jobs?job=${r.job.id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };

  const saveTask = () => {
    setBusy("task");
    createTask.mutate(
      { title: (label || "Shared link").slice(0, 300), notes: url || text || null, due_date: today, tags: [] },
      {
        onSuccess: () => {
          toast.success("Added to today");
          router.replace("/");
        },
        onError: (e) => {
          toast.error((e as Error).message);
          setBusy(null);
        },
      },
    );
  };

  const saveLearning = () => {
    const q = new URLSearchParams({ new: "1", title: label.slice(0, 200) });
    if (url) q.set("url", url);
    router.replace(`/learning?${q.toString()}`);
  };

  const options = [
    { id: "job", icon: Briefcase, title: "Save job to tracker", desc: "Scout reads the posting, fills in the details and scores it for you.", onClick: saveJob, disabled: !url, primary: looksLikeJob },
    { id: "task", icon: CheckSquare, title: "Add as a task for today", desc: "Keeps the link in the task notes.", onClick: saveTask, primary: !looksLikeJob && !!url },
    { id: "learning", icon: GraduationCap, title: "Log as learning", desc: "Opens today's learning entry with this as a resource.", onClick: saveLearning, primary: false },
  ];

  return (
    <div className="mx-auto max-w-[620px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader title="Save to Productivize" icon={<Share2 className="h-5 w-5" />} />
      <Card className="mb-5 p-4">
        <div className="text-[14px] font-medium text-fg">{label || "Nothing was shared"}</div>
        {url ? <div className="mt-1 truncate text-[12.5px] text-accent">{url}</div> : null}
        {text && text !== url && text !== title ? <div className="mt-2 line-clamp-3 text-[12.5px] text-muted">{text}</div> : null}
      </Card>
      <div className="space-y-2.5">
        {options.map((o) => (
          <button
            key={o.id}
            disabled={o.disabled || !!busy}
            onClick={o.onClick}
            className={cn(
              "flex w-full items-center gap-3.5 rounded-xl border p-4 text-left transition-colors disabled:opacity-50",
              o.primary ? "border-accent/40 bg-accent-soft/50 hover:bg-accent-soft" : "border-line bg-panel hover:border-line-strong",
            )}
          >
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", o.primary ? "bg-accent text-white" : "bg-panel-2 text-muted")}>
              <o.icon className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium text-fg">{o.title}</span>
              <span className="block text-[12.5px] text-muted">{o.desc}</span>
            </span>
            {busy === o.id ? <span className="text-[12px] text-muted">Working…</span> : null}
          </button>
        ))}
      </div>
      <div className="mt-6 flex justify-center">
        <Button variant="ghost" onClick={() => router.replace("/")}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
