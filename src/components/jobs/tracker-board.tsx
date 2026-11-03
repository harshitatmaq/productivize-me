"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Link2, Plus } from "lucide-react";
import { api } from "@/lib/utils";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { useAddJob, useUpdateJob } from "@/lib/queries/jobs";
import type { Job } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { CompanyLogo, STATUS_META } from "./job-bits";

const COLUMNS: Job["status"][] = ["saved", "applied", "interviewing", "offer", "rejected"];

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function sha(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

export function TrackerBoard({ jobs, onOpen }: { jobs: Job[]; onOpen: (j: Job) => void }) {
  const update = useUpdateJob();
  const add = useAddJob();
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", company: "", url: "", status: "applied" as Job["status"], location: "" });
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const qc = useQueryClient();

  const importLink = async () => {
    if (!/^https?:\/\//.test(importUrl.trim())) return toast.error("Paste a full link starting with https://");
    setImporting(true);
    try {
      const status = form.status === "saved" ? "saved" : "applied";
      const r = await api<{ job: Job; duplicate?: boolean; extracted: boolean }>("/api/jobs/import", { json: { url: importUrl.trim(), status } });
      if (form.status !== status && !r.duplicate) update.mutate({ id: r.job.id, patch: { status: form.status } });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success(r.duplicate ? "Already on your board" : `Added: ${r.job.title}${r.job.company ? ` @ ${r.job.company}` : ""}`, {
        description: r.extracted ? (r.job.score != null ? `Match score ${r.job.score}` : undefined) : "Couldn't read the page fully — edit the details if needed.",
      });
      setImportUrl("");
      setAdding(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setImporting(false);
    }
  };

  const move = (id: string, status: Job["status"]) => {
    const job = jobs.find((j) => j.id === id);
    if (!job || job.status === status) return;
    update.mutate({
      id,
      patch: { status, ...(status === "applied" && !job.applied_at ? { applied_at: new Date().toISOString() } : {}) },
    });
    toast(`Moved to ${STATUS_META[status].label}`);
  };

  const submit = async () => {
    if (!form.title.trim()) return toast.error("Add a job title");
    const url = form.url.trim() || `manual://${slug(form.company)}/${slug(form.title)}/${Date.now()}`;
    add.mutate(
      {
        title: form.title.trim(),
        company: form.company.trim() || null,
        location: form.location.trim() || null,
        url,
        url_hash: await sha(url),
        dedupe_key: form.company ? `${slug(form.company)}|${slug(form.title)}` : `manual:${Date.now()}`,
        source: "manual",
        status: form.status,
        applied_at: form.status !== "saved" ? new Date().toISOString() : null,
        company_domain: (() => {
          try {
            return form.url ? new URL(form.url).hostname.replace(/^www\./, "") : null;
          } catch {
            return null;
          }
        })(),
      },
      {
        onSuccess: () => {
          setAdding(false);
          setForm({ title: "", company: "", url: "", status: "applied", location: "" });
        },
        onError: (e) => toast.error((e as Error).message.includes("duplicate") ? "That job is already on your board" : (e as Error).message),
      },
    );
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12.5px] text-muted">Drag cards between columns (or open a card to change its stage).</p>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> Add application
        </Button>
      </div>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:mx-0 md:grid md:grid-cols-5 md:overflow-visible md:px-0">
        {COLUMNS.map((col) => {
          const list = jobs.filter((j) => j.status === col);
          return (
            <div
              key={col}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col);
              }}
              onDragLeave={() => setOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) move(dragId, col);
                setDragId(null);
                setOver(null);
              }}
              className={cn(
                "flex w-[78vw] max-w-[300px] shrink-0 snap-start flex-col rounded-xl border bg-panel-2/50 p-2 transition-colors md:w-auto md:max-w-none",
                over === col ? "border-accent/50 bg-accent-soft/40" : "border-line",
              )}
            >
              <div className="mb-2 flex items-center gap-2 px-1.5 pt-1">
                <span className="h-2 w-2 rounded-full" style={{ background: STATUS_META[col].color }} />
                <span className="text-[12.5px] font-medium text-fg">{STATUS_META[col].label}</span>
                <span className="text-[12px] text-faint">{list.length}</span>
              </div>
              <div className="flex min-h-24 flex-col gap-2">
                {list.map((j) => (
                  <button
                    key={j.id}
                    draggable
                    onDragStart={() => setDragId(j.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => onOpen(j)}
                    className={cn(
                      "rounded-lg border border-line bg-panel p-2.5 text-left transition-all hover:border-line-strong",
                      dragId === j.id && "opacity-50",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <CompanyLogo name={j.company} domain={j.company_domain} logo={j.company_logo} size={22} />
                      <span className="truncate text-[12px] text-muted">{j.company}</span>
                    </div>
                    <div className="mt-1.5 line-clamp-2 text-[13px] font-medium leading-snug text-fg">{j.title}</div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-faint">
                      <span>{j.applied_at ? `applied ${timeAgo(j.applied_at)}` : timeAgo(j.updated_at)}</span>
                      {j.next_step_date ? <span className="text-warning">next: {j.next_step_date.slice(5)}</span> : null}
                    </div>
                  </button>
                ))}
                {list.length === 0 ? <div className="px-2 py-6 text-center text-[12px] text-faint">Drop here</div> : null}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={adding}
        onOpenChange={setAdding}
        title="Add an application"
        description="Track a role you found elsewhere."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submit} loading={add.isPending}>
              Add
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-accent/25 bg-accent-soft/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[12.5px] font-medium text-fg">
              <Link2 className="h-3.5 w-3.5 text-accent" /> Paste a job link — Scout reads it, fills the details and scores it
            </div>
            <div className="flex gap-2">
              <Input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://www.linkedin.com/jobs/view/…" onKeyDown={(e) => e.key === "Enter" && importLink()} />
              <Button variant="primary" onClick={importLink} loading={importing}>
                Import
              </Button>
            </div>
          </div>
          <div className="text-center text-[11.5px] text-faint">— or enter it by hand —</div>
          <Field label="Job title">
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Senior Backend Engineer" autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company">
              <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </Field>
            <Field label="Location">
              <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
            </Field>
          </div>
          <Field label="Link (optional)">
            <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
          </Field>
          <Field label="Stage">
            <Select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Job["status"] })}>
              {COLUMNS.map((c) => (
                <option key={c} value={c}>
                  {STATUS_META[c].label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Dialog>
    </div>
  );
}
