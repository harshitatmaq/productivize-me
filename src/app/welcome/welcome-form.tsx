"use client";

import { ArrowRight } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { supabaseBrowser } from "@/lib/supabase/client";

/** After an invite (or sign-in) link: choose a name and password, then continue. */
export function WelcomeForm() {
  const params = useSearchParams();
  const fromLink = params.get("from") === "link";
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = supabaseBrowser();
    sb.auth.getUser().then(async ({ data }) => {
      // Full reload on purpose: the session cookie decides where the proxy sends you.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (!data.user) return window.location.assign("/login");
      setEmail(data.user.email ?? null);
      const { data: p } = await sb.from("profiles").select("full_name").eq("id", data.user.id).maybeSingle();
      if (p?.full_name) setName(p.full_name);
    });
  }, []);

  const go = async () => {
    // Pending invites first, so they can accept straight away.
    const { count } = await supabaseBrowser().from("space_invites").select("id", { count: "exact", head: true }).eq("status", "pending");
    window.location.assign(count ? "/together" : "/");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!fromLink && password.length < 8) return setError("Use at least 8 characters.");
    if (password && password.length < 8) return setError("Use at least 8 characters.");
    setLoading(true);
    const sb = supabaseBrowser();
    const { data, error } = await sb.auth.updateUser({ ...(password ? { password } : {}), data: { full_name: name.trim() } });
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    if (name.trim() && data.user) await sb.from("profiles").update({ full_name: name.trim() }).eq("id", data.user.id);
    await go();
  };

  return (
    <div className="relative w-full max-w-[380px] animate-fade-in">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-line-strong bg-panel shadow-card">
          <LogoMark className="h-6 w-6" />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{fromLink ? "You're signed in" : "Welcome to Productivize"}</h1>
        <p className="mt-1 text-[13.5px] text-muted">
          {fromLink ? "Set a new password if you like, or skip." : "Choose your name and a password to finish setting up."}
          {email ? <span className="block text-faint">{email}</span> : null}
        </p>
      </div>
      <form onSubmit={submit} className="card space-y-4 p-5">
        <Field label="Your name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="First and last name" required={!fromLink} />
        </Field>
        <Field label={fromLink ? "New password (optional)" : "Password"} hint="At least 8 characters.">
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!fromLink} />
        </Field>
        {error ? <p className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>
          Continue <ArrowRight className="h-4 w-4" />
        </Button>
        {fromLink ? (
          <button type="button" onClick={go} className="w-full text-center text-[12.5px] text-muted hover:text-fg">
            Skip for now
          </button>
        ) : null}
      </form>
    </div>
  );
}
