"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Briefcase, Download, LogOut, Mail, Monitor, Moon, Palette, Plug, Settings, Smartphone, Sun, Trash2, UserRound } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { Badge, Card, PageHeader, Segmented } from "@/components/ui/misc";
import { useIsStandalone, useResettableState } from "@/lib/hooks";
import { sb } from "@/lib/queries/client";
import { useProfile, useUpdateProfile, useUser } from "@/lib/queries/profile";
import { currentSubscription, disablePush, enablePush, pushSupport } from "@/lib/push-client";
import type { Profile } from "@/lib/types";
import { api, timeAgo } from "@/lib/utils";
import { IntegrationStatus } from "./integration-status";

function Section({ id, title, icon, children, description }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode; description?: string }) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-muted">{icon}</span>
        <h2 className="text-[15px] font-semibold text-fg">{title}</h2>
      </div>
      {description ? <p className="-mt-1 mb-3 text-[12.5px] text-muted">{description}</p> : null}
      {children}
    </section>
  );
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

function InstallCard() {
  const standalone = useIsStandalone();
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [platform] = useState<"ios" | "android" | "desktop">(() => {
    const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
    return /iphone|ipad|ipod/i.test(ua) ? "ios" : /android/i.test(ua) ? "android" : "desktop";
  });
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (standalone) {
    return (
      <Card className="flex items-center gap-3 p-4 text-[13px] text-fg-2">
        <Smartphone className="h-4 w-4 text-success" /> Installed — you&apos;re using the app version.
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 text-[13px] text-fg-2">
          <div className="mb-2 font-medium text-fg">Install on your phone for an app-like experience and notifications</div>
          {platform === "ios" ? (
            <ol className="list-decimal space-y-1 pl-4">
              <li>Open this site in <b>Safari</b>.</li>
              <li>Tap <b>Share</b> → <b>Add to Home Screen</b>.</li>
              <li>Open Productivize from the Home Screen, then enable notifications below.</li>
            </ol>
          ) : platform === "android" ? (
            <ol className="list-decimal space-y-1 pl-4">
              <li>In Chrome, tap <b>⋮</b> → <b>Install app</b> (or use the button).</li>
              <li>Open it from your home screen and enable notifications below.</li>
            </ol>
          ) : (
            <p>In Chrome or Edge, click the install icon in the address bar (or use the button) to get a standalone window. On your phone, open this same URL and add it to the home screen.</p>
          )}
        </div>
        {evt ? (
          <Button
            variant="primary"
            onClick={async () => {
              await evt.prompt();
              setEvt(null);
            }}
          >
            <Download className="h-4 w-4" /> Install app
          </Button>
        ) : null}
      </div>
    </Card>
  );
}

function PushCard({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const update = useUpdateProfile();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const support = useMemo(() => (typeof window === "undefined" ? "unsupported" : pushSupport()), []);
  const { data: devices = [] } = useQuery({
    queryKey: ["push-devices"],
    queryFn: async () => {
      const { data } = await sb().from("push_subscriptions").select("id, endpoint, device_label, created_at, last_success_at").order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  useEffect(() => {
    currentSubscription().then((s) => setSubscribed(!!s));
  }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (subscribed) {
        await disablePush();
        setSubscribed(false);
        toast("Notifications turned off on this device");
      } else {
        await enablePush();
        setSubscribed(true);
        toast.success("Notifications enabled on this device");
      }
      qc.invalidateQueries({ queryKey: ["push-devices"] });
    } catch (e) {
      toast.error((e as Error).message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    try {
      await api("/api/push/test", { method: "POST" });
      toast.success("Test notification sent");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Card className="divide-y divide-line px-4">
      <div className="flex flex-wrap items-center gap-3 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] text-fg">Push on this device</div>
          <div className="text-[12px] text-muted">
            {support === "ios-needs-install"
              ? "iPhone: add to Home Screen first (see Install below), then enable here."
              : support === "unsupported"
                ? "This browser doesn't support web push."
                : subscribed
                  ? "This device will receive reminders and alerts."
                  : "Turn on to get reminders, end-of-day reviews and job alerts here."}
          </div>
        </div>
        {subscribed ? (
          <Button size="sm" variant="ghost" onClick={test}>
            Send test
          </Button>
        ) : null}
        <Button size="sm" variant={subscribed ? "secondary" : "primary"} onClick={toggle} loading={busy || subscribed === null} disabled={support !== "supported"}>
          {subscribed ? "Turn off" : "Enable notifications"}
        </Button>
      </div>
      <div className="py-1">
        <Switch label="Push notifications (all devices)" description="Master switch for push delivery." checked={profile.notify_push} onChange={(v) => update.mutate({ notify_push: v })} />
      </div>
      {devices.length ? (
        <div className="py-3">
          <div className="mb-2 text-[12px] font-medium text-muted">Registered devices</div>
          <ul className="space-y-1.5">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-[13px] text-fg-2">
                <Smartphone className="h-3.5 w-3.5 text-faint" />
                <span className="flex-1 truncate">{d.device_label ?? "Device"}</span>
                <span className="text-[11.5px] text-faint">{d.last_success_at ? `last push ${timeAgo(d.last_success_at)}` : `added ${timeAgo(d.created_at)}`}</span>
                <button
                  className="rounded p-1 text-faint hover:text-danger"
                  aria-label="Remove device"
                  onClick={async () => {
                    await sb().from("push_subscriptions").delete().eq("id", d.id);
                    qc.invalidateQueries({ queryKey: ["push-devices"] });
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

export function SettingsView() {
  const { data: profile } = useProfile();
  const { data: user } = useUser();
  const update = useUpdateProfile();
  const { theme, setTheme } = useTheme();
  const [name, setName] = useResettableState(profile?.full_name, (n) => n ?? "");
  const timezones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return ["Asia/Kolkata", "UTC"];
    }
  }, []);

  if (!profile) return null;
  const set = (patch: Partial<Profile>) => update.mutate(patch, { onError: (e) => toast.error((e as Error).message) });

  return (
    <div className="mx-auto max-w-[820px] px-4 pt-5 md:px-8 md:pt-10">
      <PageHeader title="Settings" icon={<Settings className="h-5 w-5" />} subtitle={user?.email ?? undefined} />
      <div className="space-y-10">
        <Section id="profile" title="Profile" icon={<UserRound className="h-4 w-4" />}>
          <Card className="space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== profile.full_name && set({ full_name: name })} />
              </Field>
              <Field label="Email">
                <Input value={profile.email ?? ""} disabled />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Time zone" hint="Synced from your device automatically.">
                <Select value={profile.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Week starts on">
                <Select value={profile.week_starts_on} onChange={(e) => set({ week_starts_on: Number(e.target.value) })}>
                  <option value={1}>Monday</option>
                  <option value={0}>Sunday</option>
                  <option value={6}>Saturday</option>
                </Select>
              </Field>
            </div>
          </Card>
        </Section>

        <Section id="notifications" title="Notifications" icon={<BellRing className="h-4 w-4" />} description="Times for the morning brief, end-of-day review and learning nudge live on the Reminders page.">
          <PushCard profile={profile} />
        </Section>

        <Section id="email" title="Email" icon={<Mail className="h-4 w-4" />}>
          <Card className="divide-y divide-line px-4">
            <Switch label="Email notifications" description={`Sent to ${profile.email}.`} checked={profile.notify_email} onChange={(v) => set({ notify_email: v })} />
            <Switch label="Daily digest" description="With the morning brief: today's tasks, overdue items, new job matches." checked={profile.email_daily_digest} onChange={(v) => set({ email_daily_digest: v })} disabled={!profile.notify_email} />
            <Switch label="Weekly & monthly review" description="Your week (and month) in numbers." checked={profile.email_weekly_review} onChange={(v) => set({ email_weekly_review: v })} disabled={!profile.notify_email} />
            <Switch label="Also email alerts" description="End-of-day unfinished tasks and missed learning days, in addition to push." checked={profile.email_alerts} onChange={(v) => set({ email_alerts: v })} disabled={!profile.notify_email} />
            <div className="flex justify-end py-3">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await api("/api/email/test", { method: "POST" });
                    toast.success("Test email sent");
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Send test email
              </Button>
            </div>
          </Card>
        </Section>

        <Section id="install" title="Mobile app" icon={<Smartphone className="h-4 w-4" />}>
          <InstallCard />
        </Section>

        <Section id="jobs" title="Job search" icon={<Briefcase className="h-4 w-4" />}>
          <Card className="divide-y divide-line px-4">
            <Switch label="Hourly job search" description="Scout searches every hour once your profile is ready." checked={profile.job_search_enabled} onChange={(v) => set({ job_search_enabled: v })} />
            <div className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="text-[13.5px] text-fg">Alert me for matches scoring at least</div>
                <div className="text-[12px] text-muted">Lower = more alerts.</div>
              </div>
              <Segmented
                value={String(profile.job_alert_min_score)}
                onChange={(v) => set({ job_alert_min_score: Number(v) })}
                options={["60", "70", "75", "80", "90"].map((v) => ({ value: v, label: v }))}
              />
            </div>
          </Card>
        </Section>

        <Section id="integrations" title="Integrations" icon={<Plug className="h-4 w-4" />} description="API keys live in the server environment (never in the browser). Anything unticked is skipped automatically.">
          <IntegrationStatus />
        </Section>

        <Section id="appearance" title="Appearance" icon={<Palette className="h-4 w-4" />}>
          <Card className="flex items-center justify-between p-4">
            <span className="text-[13.5px] text-fg">Theme</span>
            <Segmented
              value={theme ?? "dark"}
              onChange={setTheme}
              options={[
                { value: "dark", label: <span className="inline-flex items-center gap-1.5"><Moon className="h-3.5 w-3.5" /> Dark</span> },
                { value: "light", label: <span className="inline-flex items-center gap-1.5"><Sun className="h-3.5 w-3.5" /> Light</span> },
                { value: "system", label: <span className="inline-flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" /> System</span> },
              ]}
            />
          </Card>
        </Section>

        <div className="flex items-center justify-between border-t border-line pt-6">
          <Badge tone="outline">Productivize · open source</Badge>
          <Button
            variant="danger"
            onClick={async () => {
              await sb().auth.signOut();
              // Full reload on purpose: clears every cached query from the previous session.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/login");
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
