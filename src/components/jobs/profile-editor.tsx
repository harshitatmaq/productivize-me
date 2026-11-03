"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Building2, RefreshCw, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useResettableState } from "@/lib/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipsInput } from "@/components/ui/chips-input";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Badge, Card, SectionTitle } from "@/components/ui/misc";
import { useUpdateJobProfile } from "@/lib/queries/jobs";
import type { JobProfile, WatchCompany } from "@/lib/jobs/types";
import type { JobProfileRow } from "@/lib/types";
import { api } from "@/lib/utils";

/** Mirrors parseWatchCompany() on the server (kept client-side to avoid importing node crypto). */
function parseCompany(input: string): WatchCompany | null {
  const s = input.trim();
  const patterns: [RegExp, WatchCompany["ats"]][] = [
    [/(?:job-)?boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([a-z0-9_-]+)/i, "greenhouse"],
    [/jobs\.lever\.co\/([a-z0-9_-]+)/i, "lever"],
    [/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i, "ashby"],
    [/apply\.workable\.com\/([a-z0-9_-]+)/i, "workable"],
    [/(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/i, "smartrecruiters"],
  ];
  for (const [re, ats] of patterns) {
    const m = s.match(re);
    if (m) return { ats, slug: m[1], name: m[1] };
  }
  const short = s.match(/^(greenhouse|lever|ashby|workable|smartrecruiters)\s*[:/]\s*([a-z0-9_.-]+)$/i);
  return short ? { ats: short[1].toLowerCase() as WatchCompany["ats"], slug: short[2], name: short[2] } : null;
}

export function ProfileEditor({ row }: { row: JobProfileRow }) {
  const qc = useQueryClient();
  const updateRow = useUpdateJobProfile();
  // Keyed on the serialized profile so a background refetch with identical data keeps unsaved edits.
  const profileKey = JSON.stringify(row.profile ?? {});
  const [p, setP] = useResettableState<JobProfile, string>(profileKey, (k) => JSON.parse(k));
  const [dirty, setDirty] = useResettableState(profileKey, () => false);
  const [saving, setSaving] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [companyInput, setCompanyInput] = useState("");

  const set = <K extends keyof JobProfile>(k: K, v: JobProfile[K]) => {
    setP((x) => ({ ...x, [k]: v }));
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api("/api/jobs/profile", { json: { action: "save", profile: p } });
      qc.invalidateQueries({ queryKey: ["job-profile"] });
      setDirty(false);
      toast.success("Profile saved — the next search uses it");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const replan = async () => {
    setReplanning(true);
    try {
      await api("/api/jobs/profile", { json: { action: "replan" } });
      qc.invalidateQueries({ queryKey: ["job-profile"] });
      toast.success("Search plan regenerated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReplanning(false);
    }
  };

  const addCompany = () => {
    const c = parseCompany(companyInput);
    if (!c) return toast.error("Paste a Greenhouse, Lever, Ashby, Workable or SmartRecruiters careers URL (or e.g. greenhouse:stripe)");
    const list = row.watch_companies ?? [];
    if (list.some((x) => x.ats === c.ats && x.slug === c.slug)) return toast("Already watching");
    updateRow.mutate({ watch_companies: [...list, c] });
    setCompanyInput("");
  };

  const plan = row.search_plan;

  return (
    <div className="space-y-6">
      <Card className="p-4">
        <div className="mb-4 flex items-center justify-between gap-2">
          <SectionTitle className="mb-0">Your search profile</SectionTitle>
          <Button size="sm" variant={dirty ? "primary" : "secondary"} onClick={save} loading={saving} disabled={!dirty}>
            <Save className="h-3.5 w-3.5" /> Save
          </Button>
        </div>
        <div className="space-y-4">
          <Field label="Headline">
            <Input value={p.headline ?? ""} onChange={(e) => set("headline", e.target.value)} placeholder="Backend engineer · Go & distributed systems" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Current title">
              <Input value={p.current_title ?? ""} onChange={(e) => set("current_title", e.target.value)} />
            </Field>
            <Field label="Years of experience">
              <Input type="number" min={0} step={0.5} value={p.years_experience ?? ""} onChange={(e) => set("years_experience", e.target.value ? Number(e.target.value) : undefined)} />
            </Field>
          </div>
          <Field label="Target titles">
            <ChipsInput value={p.target_titles ?? []} onChange={(v) => set("target_titles", v)} placeholder="Senior Backend Engineer, Platform Engineer…" />
          </Field>
          <Field label="Seniority">
            <ChipsInput value={p.seniority ?? []} onChange={(v) => set("seniority", v)} placeholder="mid, senior…" />
          </Field>
          <Field label="Skills">
            <ChipsInput value={p.skills ?? []} onChange={(v) => set("skills", v)} placeholder="Go, Kubernetes, PostgreSQL…" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Locations">
              <ChipsInput value={p.locations ?? []} onChange={(v) => set("locations", v)} placeholder="Bengaluru, Remote…" />
            </Field>
            <Field label="Countries (2-letter codes)">
              <ChipsInput value={p.countries ?? []} onChange={(v) => set("countries", v.map((c) => c.toLowerCase().slice(0, 2)))} placeholder="in, us…" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Work mode">
              <Select value={p.remote ?? "any"} onChange={(e) => set("remote", e.target.value as JobProfile["remote"])}>
                <option value="any">Any</option>
                <option value="remote">Remote only</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </Select>
            </Field>
            <Field label="Expected pay">
              <Input value={p.salary_expectation ?? ""} onChange={(e) => set("salary_expectation", e.target.value)} placeholder="₹35–45 LPA" />
            </Field>
            <Field label="Notice period">
              <Input value={p.notice_period ?? ""} onChange={(e) => set("notice_period", e.target.value)} placeholder="30 days" />
            </Field>
          </div>
          <Field label="Work authorization">
            <Input value={p.work_authorization ?? ""} onChange={(e) => set("work_authorization", e.target.value)} placeholder="Indian citizen; needs visa sponsorship for US" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Must-haves">
              <ChipsInput value={p.must_haves ?? []} onChange={(v) => set("must_haves", v)} />
            </Field>
            <Field label="Deal-breakers">
              <ChipsInput value={p.deal_breakers ?? []} onChange={(v) => set("deal_breakers", v)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dream companies">
              <ChipsInput value={p.target_companies ?? []} onChange={(v) => set("target_companies", v)} />
            </Field>
            <Field label="Avoid companies">
              <ChipsInput value={p.avoid_companies ?? []} onChange={(v) => set("avoid_companies", v)} />
            </Field>
          </div>
          <Field label="Exclude titles containing" hint="e.g. intern, sales, principal">
            <ChipsInput value={p.exclude_keywords ?? []} onChange={(v) => set("exclude_keywords", v)} />
          </Field>
          <Field label="Summary">
            <Textarea rows={4} value={p.summary ?? ""} onChange={(e) => set("summary", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card className="p-4">
        <SectionTitle>
          <span className="inline-flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> Watch company career pages
          </span>
        </SectionTitle>
        <p className="mb-3 text-[12.5px] text-muted">
          Checked every 2 hours straight from their applicant-tracking system — no API key needed. Paste a careers URL like{" "}
          <code className="text-fg-2">boards.greenhouse.io/stripe</code>, <code className="text-fg-2">jobs.lever.co/netflix</code> or{" "}
          <code className="text-fg-2">jobs.ashbyhq.com/openai</code>.
        </p>
        <div className="flex gap-2">
          <Input value={companyInput} onChange={(e) => setCompanyInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCompany()} placeholder="Careers page URL" />
          <Button onClick={addCompany}>Add</Button>
        </div>
        {(row.watch_companies ?? []).length ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {row.watch_companies.map((c) => (
              <span key={`${c.ats}:${c.slug}`} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-panel-2 pl-2 pr-1 text-[12.5px] text-fg-2">
                {c.name ?? c.slug}
                <span className="text-[11px] text-faint">{c.ats}</span>
                <button
                  className="rounded p-0.5 text-faint hover:text-danger"
                  onClick={() => updateRow.mutate({ watch_companies: row.watch_companies.filter((x) => !(x.ats === c.ats && x.slug === c.slug)) })}
                  aria-label="Remove"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <SectionTitle className="mb-0">Search plan (auto-generated daily)</SectionTitle>
          <Button size="sm" variant="ghost" onClick={replan} loading={replanning}>
            <RefreshCw className="h-3.5 w-3.5" /> Regenerate
          </Button>
        </div>
        {plan?.titles?.length ? (
          <div className="space-y-3 text-[12.5px]">
            <div>
              <div className="mb-1 text-muted">Titles</div>
              <div className="flex flex-wrap gap-1.5">{plan.titles.map((t) => <Badge key={t}>{t}</Badge>)}</div>
            </div>
            <div>
              <div className="mb-1 text-muted">Keywords</div>
              <div className="flex flex-wrap gap-1.5">{(plan.keywords ?? []).map((t) => <Badge key={t} tone="outline">{t}</Badge>)}</div>
            </div>
            <div>
              <div className="mb-1 text-muted">Web queries (rotated each hour)</div>
              <ul className="space-y-1 text-fg-2">
                {(plan.web_queries ?? []).map((q, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="truncate">{q.q}</span>
                    {q.domains ? <Badge tone="accent">{q.domains}</Badge> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Generated when the first search runs.</p>
        )}
      </Card>
    </div>
  );
}
