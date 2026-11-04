import { ArrowUpRight, Briefcase, FileText, Globe, GraduationCap, Mail, MapPin, Award, Sparkles } from "lucide-react";
import type { PortfolioData } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.7.3 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}

function LinkedinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M20.4 20.5h-3.6v-5.6c0-1.3 0-3-1.8-3s-2.1 1.4-2.1 2.9v5.7H9.3V9h3.4v1.6c.5-.9 1.6-1.8 3.4-1.8 3.6 0 4.3 2.4 4.3 5.5v6.2ZM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2ZM7.1 20.5H3.5V9h3.6v11.5ZM22.2 0H1.8C.8 0 0 .8 0 1.7v20.6c0 .9.8 1.7 1.8 1.7h20.4c1 0 1.8-.8 1.8-1.7V1.7C24 .8 23.2 0 22.2 0Z" />
    </svg>
  );
}

const ensureUrl = (u?: string) => (!u ? undefined : /^https?:\/\//.test(u) || u.startsWith("mailto:") ? u : `https://${u}`);

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="py-10">
      <h2 className="mb-6 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.14em] text-muted">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The portfolio itself — used for the live preview and the public /p/[slug] page. */
export function PortfolioView({ data, className }: { data: PortfolioData; className?: string }) {
  const links = [
    data.links.github && { href: ensureUrl(data.links.github), label: "GitHub", icon: <GithubIcon /> },
    data.links.linkedin && { href: ensureUrl(data.links.linkedin), label: "LinkedIn", icon: <LinkedinIcon /> },
    data.links.website && { href: ensureUrl(data.links.website), label: "Website", icon: <Globe className="h-4 w-4" /> },
    data.links.email && { href: `mailto:${data.links.email}`, label: "Email", icon: <Mail className="h-4 w-4" /> },
  ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode }[];

  const featured = data.projects.filter((p) => p.featured);
  const others = data.projects.filter((p) => !p.featured);

  return (
    <div className={cn("relative", className)}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] glow-top" />
      <div className="relative mx-auto max-w-[760px] px-5 pb-20 pt-16 sm:pt-24">
        <header className="pb-6">
          {data.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatar_url} alt="" className="mb-6 h-20 w-20 rounded-2xl border border-line-strong object-cover shadow-card" />
          ) : null}
          {data.open_to_work ? (
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-[12px] font-medium text-success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              {data.availability || "Open to new opportunities"}
            </div>
          ) : null}
          <h1 className="text-[36px] font-semibold leading-[1.1] tracking-[-0.03em] text-fg sm:text-[48px]">{data.name || "Your name"}</h1>
          <p className="mt-3 text-[17px] leading-relaxed text-fg-2 sm:text-[19px]">{data.headline || "A one-line headline about what you do."}</p>
          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13.5px] text-muted">
            {data.location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5" /> {data.location}
              </span>
            ) : null}
            {links.map((l) => (
              <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:text-fg">
                {l.icon} {l.label}
              </a>
            ))}
            {data.links.resume ? (
              <a href={ensureUrl(data.links.resume)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-panel px-2.5 py-1 text-fg hover:border-accent">
                <FileText className="h-3.5 w-3.5" /> Resume
              </a>
            ) : null}
          </div>
        </header>

        {data.about ? (
          <section className="py-8">
            <div className="space-y-4 text-[15.5px] leading-[1.75] text-fg-2">
              {data.about.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        ) : null}

        {data.skills.length ? (
          <Section title="Skills" icon={<Sparkles className="h-3.5 w-3.5" />}>
            <div className="space-y-4">
              {data.skills.map((g, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[140px_1fr]">
                  <div className="text-[13px] text-muted">{g.group}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((s) => (
                      <span key={s} className="rounded-md border border-line bg-panel px-2 py-0.5 text-[13px] text-fg-2">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ) : null}

        {data.experience.length ? (
          <Section title="Experience" icon={<Briefcase className="h-3.5 w-3.5" />}>
            <ol className="relative space-y-8 border-l border-line pl-6">
              {data.experience.map((e, i) => (
                <li key={i} className="relative">
                  <span className="absolute -left-[29px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-accent bg-bg" />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <h3 className="text-[15.5px] font-medium text-fg">
                      {e.role} <span className="text-muted">· {e.company}</span>
                    </h3>
                    <span className="text-[12.5px] tabular-nums text-faint">
                      {[e.start, e.end || (e.start ? "Present" : "")].filter(Boolean).join(" — ")}
                    </span>
                  </div>
                  {e.location ? <div className="mt-0.5 text-[12.5px] text-faint">{e.location}</div> : null}
                  {e.bullets.length ? (
                    <ul className="mt-2.5 space-y-1.5">
                      {e.bullets.map((b, j) => (
                        <li key={j} className="flex gap-2.5 text-[14px] leading-relaxed text-fg-2">
                          <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-faint" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ol>
          </Section>
        ) : null}

        {data.projects.length ? (
          <Section title="Projects" icon={<Globe className="h-3.5 w-3.5" />}>
            <div className="grid gap-3 sm:grid-cols-2">
              {[...featured, ...others].map((p, i) => {
                const href = ensureUrl(p.url || p.repo);
                const Comp = href ? "a" : "div";
                return (
                  <Comp
                    key={i}
                    {...(href ? { href, target: "_blank", rel: "noreferrer" } : {})}
                    className={cn(
                      "group flex flex-col rounded-xl border border-line bg-panel p-4 transition-all hover:border-line-strong hover:shadow-card",
                      p.featured && "sm:col-span-2",
                    )}
                  >
                    {p.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.image} alt="" className="mb-3 aspect-[2/1] w-full rounded-lg border border-line object-cover" />
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-[14.5px] font-medium text-fg">{p.name}</h3>
                      {href ? <ArrowUpRight className="h-4 w-4 text-faint transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg" /> : null}
                    </div>
                    <p className="mt-1.5 flex-1 text-[13.5px] leading-relaxed text-muted">{p.description}</p>
                    {p.tech.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {p.tech.map((t) => (
                          <span key={t} className="text-[11.5px] text-faint">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </Comp>
                );
              })}
            </div>
          </Section>
        ) : null}

        {data.education.length || data.certifications.length ? (
          <Section title="Education" icon={<GraduationCap className="h-3.5 w-3.5" />}>
            <div className="space-y-3">
              {data.education.map((e, i) => (
                <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <div className="text-[14.5px] text-fg">
                    {e.degree} <span className="text-muted">· {e.school}</span>
                  </div>
                  {e.year ? <span className="text-[12.5px] text-faint">{e.year}</span> : null}
                </div>
              ))}
              {data.certifications.length ? (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {data.certifications.map((c) => (
                    <span key={c} className="rounded-md border border-line px-2 py-0.5 text-[12.5px] text-fg-2">
                      {c}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </Section>
        ) : null}

        {data.achievements.length ? (
          <Section title="Highlights" icon={<Award className="h-3.5 w-3.5" />}>
            <ul className="space-y-2">
              {data.achievements.map((a, i) => (
                <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed text-fg-2">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-accent" />
                  {a}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <footer className="mt-10 border-t border-line pt-6 text-[12px] text-faint">
          {data.name ? `© ${data.name}` : null}
        </footer>
      </div>
    </div>
  );
}
