"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ClipboardCopy, ExternalLink, Rocket, Save } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { isStretch, stretchPrompt } from "@/lib/jobs/stretch";
import type { JobAnalysis, JobProfile } from "@/lib/jobs/types";
import { useJobProfile } from "@/lib/queries/jobs";
import type { Job } from "@/lib/types";
import { api, cn } from "@/lib/utils";

/** Job drawer → Tailor: hand-tailor your resume with Claude or ChatGPT, then paste it back. */
export function StretchCard({ job }: { job: Job }) {
  const { data: row } = useJobProfile();
  const qc = useQueryClient();
  const [pasted, setPasted] = useState("");
  const [saving, setSaving] = useState(false);
  const stretch = isStretch(job.score);

  const copyAndOpen = async (site?: "claude" | "chatgpt") => {
    const prompt = stretchPrompt({
      profile: (row?.profile ?? {}) as JobProfile,
      resumeText: row?.resume_text,
      job,
      analysis: job.analysis as JobAnalysis | null,
    });
    try {
      await navigator.clipboard.writeText(prompt);
      toast.success(site ? "Prompt copied — paste it in the chat (and attach your resume file if you have one)" : "Prompt copied");
    } catch {
      toast.error("Couldn't copy — your browser blocked the clipboard");
      return;
    }
    if (site) window.open(site === "claude" ? "https://claude.ai/new" : "https://chatgpt.com/", "_blank", "noopener");
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/jobs/resume-import", { json: { jobId: job.id, text: pasted } });
      setPasted("");
      qc.invalidateQueries({ queryKey: ["application", job.id] });
      toast.success("Saved as this job's resume — “Tailored resume PDF” now uses it");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={cn("rounded-xl border p-4", stretch ? "border-accent/30 bg-accent/[0.04]" : "border-line")}>
      <div className="flex items-center gap-2 text-[13.5px] font-medium text-fg">
        <Rocket className="h-4 w-4 text-accent" />
        {stretch ? `A stretch (${job.score}) — want it anyway?` : "Tailor it yourself with Claude or ChatGPT"}
      </div>
      <p className="mt-1 text-[12.5px] text-muted">
        Copies a detailed prompt with this job, your profile and resume, the gaps found, and honesty rules (reframe, never invent). Paste the result back here and it becomes this job&apos;s resume PDF.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => copyAndOpen("claude")}>
          Open Claude <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="secondary" onClick={() => copyAndOpen("chatgpt")}>
          Open ChatGPT <ExternalLink className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" onClick={() => copyAndOpen()}>
          <ClipboardCopy className="h-3.5 w-3.5" /> Copy prompt
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        <Textarea rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste the resume it wrote here…" aria-label="Paste the tailored resume" />
        <div className="flex justify-end">
          <Button size="sm" variant="secondary" onClick={save} loading={saving} disabled={pasted.trim().length < 200}>
            <Save className="h-3.5 w-3.5" /> Save as this job&apos;s resume
          </Button>
        </div>
      </div>
    </section>
  );
}
