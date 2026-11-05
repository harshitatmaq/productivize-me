"use client";

import { Tip } from "@/components/ui/menu";
import { ArrowDown, ArrowUp, Check, Copy, Eye, Globe, PencilLine, Plus, Save, Sparkles, Star, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipsInput } from "@/components/ui/chips-input";
import { Field, Input, Switch, Textarea } from "@/components/ui/field";
import { Card, PageHeader, Segmented } from "@/components/ui/misc";
import { useMediaQuery, useResettableState } from "@/lib/hooks";
import { EMPTY_PORTFOLIO, normalizePortfolio, type PortfolioData } from "@/lib/portfolio";
import { useProfile } from "@/lib/queries/profile";
import { usePortfolio, useSavePortfolio } from "@/lib/queries/portfolio";
import { api, cn } from "@/lib/utils";
import { ResumeButton } from "@/components/jobs/resume-pdf";
import { PortfolioView } from "./portfolio-view";

function Block({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-medium text-fg">{title}</h3>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </Card>
  );
}

function ItemShell({ children, onUp, onDown, onRemove }: { children: React.ReactNode; onUp?: () => void; onDown?: () => void; onRemove: () => void }) {
  return (
    <div className="relative rounded-lg border border-line bg-panel-2/50 p-3">
      <div className="absolute right-2 top-2 flex gap-0.5">
        {onUp ? (
          <Tip content="Move up">
            <button onClick={onUp} className="rounded p-1 text-faint hover:text-fg" aria-label="Move up">
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          </Tip>
        ) : null}
        {onDown ? (
          <Tip content="Move down">
            <button onClick={onDown} className="rounded p-1 text-faint hover:text-fg" aria-label="Move down">
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </Tip>
        ) : null}
        <Tip content="Remove this item">
          <button onClick={onRemove} className="rounded p-1 text-faint hover:text-danger" aria-label="Remove this item">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </Tip>
      </div>
      <div className="space-y-2.5 pr-16">{children}</div>
    </div>
  );
}

function move<T>(arr: T[], i: number, d: number): T[] {
  const j = i + d;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function PortfolioEditor() {
  const { data: row, isLoading } = usePortfolio();
  const { data: profile } = useProfile();
  const save = useSavePortfolio();
  const wide = useMediaQuery("(min-width: 1280px)");
  // Re-seed the editor whenever the saved portfolio (or, before the first save, the profile) loads.
  const seed = isLoading ? null : row ? `row:${row.updated_at}` : profile ? `profile:${profile.id}` : null;
  const [d, setD] = useResettableState<PortfolioData, typeof seed>(seed, () =>
    row ? normalizePortfolio(row.data) : { ...EMPTY_PORTFOLIO, name: profile?.full_name ?? "", links: { email: profile?.email ?? undefined } },
  );
  const [slug, setSlug] = useResettableState(seed, () => (row ? (row.slug ?? "") : slugify(profile?.full_name ?? profile?.email?.split("@")[0] ?? "")));
  const [dirty, setDirty] = useResettableState(seed, () => false);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [generating, setGenerating] = useState(false);

  const update = (patch: Partial<PortfolioData>) => {
    setD((x) => ({ ...x, ...patch }));
    setDirty(true);
  };

  const persist = (extra: { is_public?: boolean } = {}) => {
    const s = slugify(slug);
    if ((extra.is_public ?? row?.is_public) && s.length < 3) return toast.error("Pick a public link name (3+ letters)");
    save.mutate(
      { data: d, slug: s.length >= 3 ? s : null, ...extra },
      {
        onSuccess: () => {
          setDirty(false);
          toast.success(extra.is_public === true ? "Published" : extra.is_public === false ? "Unpublished" : "Saved");
        },
        onError: (e) => toast.error((e as Error).message.includes("duplicate") ? "That link name is taken" : (e as Error).message),
      },
    );
  };

  const generate = async () => {
    setGenerating(true);
    try {
      const r = await api<{ data: PortfolioData; ai: boolean }>("/api/portfolio/generate", { method: "POST" });
      const next = normalizePortfolio({ ...d, ...r.data, projects: d.projects.length ? d.projects : r.data.projects });
      setD(next);
      setDirty(true);
      toast.success(r.ai ? "Drafted from your job profile — review and save" : "Imported from your job profile (AI unavailable, copied as-is)");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const publicUrl = typeof window !== "undefined" && slug ? `${window.location.origin}/p/${slugify(slug)}` : "";
  const showEditor = wide || mode === "edit";
  const showPreview = wide || mode === "preview";

  return (
    <div className="mx-auto max-w-[1440px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader
        title="Portfolio"
        icon={<UserRound className="h-5 w-5" />}
        subtitle="Your professional home page. Edit on the left, see it live on the right, publish with one switch."
        right={
          <>
            <ResumeButton variant="secondary" label="Resume PDF" disabled={dirty} title={dirty ? "Save first" : undefined} />
            <Button variant="secondary" onClick={generate} loading={generating}>
              <Sparkles className="h-4 w-4" /> Draft from my job profile
            </Button>
            <Button variant={dirty ? "primary" : "secondary"} onClick={() => persist()} loading={save.isPending} disabled={!dirty}>
              {dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />} {dirty ? "Save" : "Saved"}
            </Button>
          </>
        }
      />

      <Card className="mb-5 flex flex-wrap items-center gap-3 p-3.5">
        <Globe className="h-4 w-4 text-muted" />
        <div className="flex min-w-[220px] flex-1 items-center gap-1 text-[13px]">
          <span className="text-faint">{typeof window !== "undefined" ? window.location.host : ""}/p/</span>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value.toLowerCase());
              setDirty(true);
            }}
            placeholder="your-name"
            className="field h-7 max-w-[200px] py-0"
          />
        </div>
        {row?.is_public && publicUrl ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(publicUrl).then(() => toast.success("Link copied"))}>
              <Copy className="h-3.5 w-3.5" /> Copy link
            </Button>
            <a href={publicUrl} target="_blank" rel="noreferrer">
              <Button size="sm" variant="ghost">
                <Eye className="h-3.5 w-3.5" /> View
              </Button>
            </a>
          </>
        ) : null}
        <label className="flex items-center gap-2 text-[13px] text-fg-2">
          <Switch checked={!!row?.is_public} onChange={(v) => persist({ is_public: v })} ariaLabel="Public portfolio" />
          {row?.is_public ? "Public" : "Private"}
        </label>
      </Card>

      {!wide ? (
        <Segmented
          className="mb-4"
          value={mode}
          onChange={setMode}
          options={[
            { value: "edit", label: <span className="inline-flex items-center gap-1.5"><PencilLine className="h-3.5 w-3.5" /> Edit</span> },
            { value: "preview", label: <span className="inline-flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" /> Preview</span> },
          ]}
        />
      ) : null}

      <div className={cn("grid gap-6", wide && "grid-cols-[480px_minmax(0,1fr)]")}>
        {showEditor ? (
          <div className="space-y-4">
            <Block title="Basics">
              <Field label="Name">
                <Input value={d.name} onChange={(e) => update({ name: e.target.value })} />
              </Field>
              <Field label="Headline">
                <Input value={d.headline} onChange={(e) => update({ headline: e.target.value })} placeholder="Data engineer building reliable pipelines at scale" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Location">
                  <Input value={d.location ?? ""} onChange={(e) => update({ location: e.target.value })} />
                </Field>
                <Field label="Photo URL">
                  <Input value={d.avatar_url ?? ""} onChange={(e) => update({ avatar_url: e.target.value })} placeholder="https://github.com/you.png" />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] text-fg-2">
                  <Switch checked={!!d.open_to_work} onChange={(v) => update({ open_to_work: v })} ariaLabel="Open to work badge" /> Open to work badge
                </label>
                {d.open_to_work ? (
                  <Input className="max-w-[260px]" value={d.availability ?? ""} onChange={(e) => update({ availability: e.target.value })} placeholder="Open to senior roles · Bengaluru / remote" />
                ) : null}
              </div>
            </Block>

            <Block title="About">
              <Textarea rows={6} value={d.about} onChange={(e) => update({ about: e.target.value })} placeholder="A few short paragraphs. Leave a blank line between paragraphs." />
            </Block>

            <Block title="Links">
              <div className="grid grid-cols-2 gap-3">
                {(["github", "linkedin", "website", "email", "resume", "twitter"] as const).map((k) => (
                  <Field key={k} label={k === "resume" ? "Resume (PDF link)" : k[0].toUpperCase() + k.slice(1)}>
                    <Input value={d.links[k] ?? ""} onChange={(e) => update({ links: { ...d.links, [k]: e.target.value } })} />
                  </Field>
                ))}
              </div>
            </Block>

            <Block
              title="Skills"
              right={
                <Button size="xs" variant="ghost" onClick={() => update({ skills: [...d.skills, { group: "", items: [] }] })}>
                  <Plus className="h-3 w-3" /> Group
                </Button>
              }
            >
              {d.skills.map((g, i) => (
                <ItemShell key={i} onRemove={() => update({ skills: d.skills.filter((_, j) => j !== i) })} onUp={i ? () => update({ skills: move(d.skills, i, -1) }) : undefined}>
                  <Input value={g.group} onChange={(e) => update({ skills: d.skills.map((x, j) => (j === i ? { ...x, group: e.target.value } : x)) })} placeholder="Group (e.g. Backend)" />
                  <ChipsInput value={g.items} onChange={(v) => update({ skills: d.skills.map((x, j) => (j === i ? { ...x, items: v } : x)) })} placeholder="Add skills" />
                </ItemShell>
              ))}
            </Block>

            <Block
              title="Experience"
              right={
                <Button size="xs" variant="ghost" onClick={() => update({ experience: [{ role: "", company: "", bullets: [] }, ...d.experience] })}>
                  <Plus className="h-3 w-3" /> Role
                </Button>
              }
            >
              {d.experience.map((e, i) => {
                const setE = (patch: Partial<typeof e>) => update({ experience: d.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <ItemShell
                    key={i}
                    onRemove={() => update({ experience: d.experience.filter((_, j) => j !== i) })}
                    onUp={i ? () => update({ experience: move(d.experience, i, -1) }) : undefined}
                    onDown={i < d.experience.length - 1 ? () => update({ experience: move(d.experience, i, 1) }) : undefined}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={e.role} onChange={(ev) => setE({ role: ev.target.value })} placeholder="Role" />
                      <Input value={e.company} onChange={(ev) => setE({ company: ev.target.value })} placeholder="Company" />
                      <Input value={e.start ?? ""} onChange={(ev) => setE({ start: ev.target.value })} placeholder="Start (e.g. 2022)" />
                      <Input value={e.end ?? ""} onChange={(ev) => setE({ end: ev.target.value })} placeholder="End (blank = present)" />
                    </div>
                    <Textarea
                      rows={3}
                      value={e.bullets.join("\n")}
                      onChange={(ev) => setE({ bullets: ev.target.value.split("\n") })}
                      onBlur={(ev) => setE({ bullets: ev.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                      placeholder="One impact bullet per line"
                    />
                  </ItemShell>
                );
              })}
            </Block>

            <Block
              title="Projects"
              right={
                <Button size="xs" variant="ghost" onClick={() => update({ projects: [...d.projects, { name: "", description: "", tech: [] }] })}>
                  <Plus className="h-3 w-3" /> Project
                </Button>
              }
            >
              {d.projects.map((p, i) => {
                const setP = (patch: Partial<typeof p>) => update({ projects: d.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <ItemShell key={i} onRemove={() => update({ projects: d.projects.filter((_, j) => j !== i) })} onUp={i ? () => update({ projects: move(d.projects, i, -1) }) : undefined}>
                    <div className="flex gap-2">
                      <Input value={p.name} onChange={(e) => setP({ name: e.target.value })} placeholder="Project name" />
                      <button
                        onClick={() => setP({ featured: !p.featured })}
                        className={cn("rounded-lg border px-2", p.featured ? "border-warning/40 text-warning" : "border-line text-faint")}
                        title="Feature (full width)"
                      >
                        <Star className="h-3.5 w-3.5" fill={p.featured ? "currentColor" : "none"} />
                      </button>
                    </div>
                    <Textarea rows={2} value={p.description} onChange={(e) => setP({ description: e.target.value })} placeholder="What it does and why it's interesting" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input value={p.url ?? ""} onChange={(e) => setP({ url: e.target.value })} placeholder="Live URL" />
                      <Input value={p.repo ?? ""} onChange={(e) => setP({ repo: e.target.value })} placeholder="Repo URL" />
                    </div>
                    <Input value={p.image ?? ""} onChange={(e) => setP({ image: e.target.value })} placeholder="Cover image URL (optional)" />
                    <ChipsInput value={p.tech} onChange={(v) => setP({ tech: v })} placeholder="Tech used" />
                  </ItemShell>
                );
              })}
            </Block>

            <Block
              title="Education & certifications"
              right={
                <Button size="xs" variant="ghost" onClick={() => update({ education: [...d.education, { degree: "", school: "" }] })}>
                  <Plus className="h-3 w-3" /> Education
                </Button>
              }
            >
              {d.education.map((e, i) => (
                <ItemShell key={i} onRemove={() => update({ education: d.education.filter((_, j) => j !== i) })}>
                  <div className="grid grid-cols-[1fr_1fr_90px] gap-2">
                    <Input value={e.degree} onChange={(ev) => update({ education: d.education.map((x, j) => (j === i ? { ...x, degree: ev.target.value } : x)) })} placeholder="Degree" />
                    <Input value={e.school} onChange={(ev) => update({ education: d.education.map((x, j) => (j === i ? { ...x, school: ev.target.value } : x)) })} placeholder="School" />
                    <Input value={e.year ?? ""} onChange={(ev) => update({ education: d.education.map((x, j) => (j === i ? { ...x, year: ev.target.value } : x)) })} placeholder="Year" />
                  </div>
                </ItemShell>
              ))}
              <Field label="Certifications">
                <ChipsInput value={d.certifications} onChange={(v) => update({ certifications: v })} placeholder="AWS SAA, CKA…" />
              </Field>
            </Block>

            <Block title="Highlights">
              <Textarea
                rows={3}
                value={d.achievements.join("\n")}
                onChange={(e) => update({ achievements: e.target.value.split("\n") })}
                onBlur={(e) => update({ achievements: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) })}
                placeholder="Awards, talks, open-source, hackathons — one per line"
              />
            </Block>
          </div>
        ) : null}

        {showPreview ? (
          <div className={cn(wide && "sticky top-6 self-start")}>
            <div className="overflow-hidden rounded-2xl border border-line-strong bg-bg shadow-pop">
              <div className="flex items-center gap-1.5 border-b border-line bg-panel-2 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
                <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
                <span className="ml-3 truncate text-[11.5px] text-faint">{publicUrl || "preview"}</span>
              </div>
              <div className={cn(wide && "max-h-[calc(100dvh-140px)] overflow-y-auto")}>
                <PortfolioView data={d} />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
