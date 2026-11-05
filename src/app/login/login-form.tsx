"use client";

import { ArrowRight, Lock } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { supabaseBrowser } from "@/lib/supabase/client";

const configured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
);

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") === "not_allowed"
      ? "This account isn't on the allow-list for this app."
      : params.get("error") === "link_expired"
        ? "That link has expired or was already used. Enter your email below and choose “Email me a sign-in link”."
        : null,
  );
  const [linkSent, setLinkSent] = useState<string | null>(null);
  const [sendingLink, setSendingLink] = useState(false);

  const emailLink = async () => {
    if (!email.trim().includes("@")) return setError("Enter your email first.");
    setSendingLink(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/email-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email.trim() }) });
      const j = (await res.json()) as { message?: string };
      setLinkSent(j.message ?? "Check your inbox.");
    } catch {
      setError("Couldn't send the link. Try again in a minute.");
    } finally {
      setSendingLink(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      setLoading(false);
      return;
    }
    const next = params.get("next");
    window.location.assign(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  };

  return (
    <div className="relative w-full max-w-[380px] animate-fade-in">
      <div className="mb-8 flex flex-col items-center text-center">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl border border-line-strong bg-panel shadow-card">
          <LogoMark className="h-6 w-6" />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Welcome back</h1>
        <p className="mt-1 text-[13.5px] text-muted">Sign in to plan your day, learn and land the next role.</p>
      </div>

      {!configured ? (
        <div className="card mb-4 border-warning/30 p-4 text-[13px] text-fg-2">
          <div className="mb-1 font-medium text-warning">Setup needed</div>
          Set <code className="text-fg">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-fg">NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> in your environment, then redeploy. See the README.
        </div>
      ) : null}

      <form onSubmit={submit} className="card space-y-4 p-5">
        <Field label="Email">
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </Field>
        <Field label="Password">
          <Input type="password" autoComplete="current-password" required={!sendingLink} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        {error ? <p className="rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p> : null}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={!configured}>
          Sign in <ArrowRight className="h-4 w-4" />
        </Button>
        {linkSent ? (
          <p className="rounded-lg bg-success/10 px-3 py-2 text-center text-[12.5px] text-success">{linkSent}</p>
        ) : (
          <button type="button" onClick={emailLink} disabled={sendingLink || !configured} className="w-full text-center text-[12.5px] text-muted transition-colors hover:text-fg disabled:opacity-50">
            {sendingLink ? "Sending…" : "Forgot password or invited? Email me a sign-in link"}
          </button>
        )}
      </form>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-[12px] text-faint">
        <Lock className="h-3 w-3" /> Private app · invite-only accounts
      </p>
    </div>
  );
}
