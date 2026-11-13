"use client";

import { Check, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Tip } from "@/components/ui/menu";
import { Card, Skeleton } from "@/components/ui/misc";
import { STANDARD_QUESTIONS, type BankCategory } from "@/lib/jobs/apply";
import type { JobProfile } from "@/lib/jobs/types";
import { useAnswerBank, useDeleteAnswer, useSaveAnswer } from "@/lib/queries/applications";
import { useUser } from "@/lib/queries/profile";

const GROUPS: { id: BankCategory; title: string; hint: string }[] = [
  { id: "contact", title: "Contact", hint: "Name, email, phone, links" },
  { id: "work", title: "Work", hint: "Current role, experience, pay, notice period" },
  { id: "eligibility", title: "Eligibility", hint: "Work authorization, sponsorship, relocation" },
  { id: "education", title: "Education", hint: "Degree, college, year" },
  { id: "reusable", title: "Reusable answers", hint: "Your general reasons; the AI adapts them per job" },
  { id: "other", title: "Optional questions", hint: "Demographic questions — “Prefer not to say” is fine" },
];
const LONG = new Set(["why_role"]);

function Row({ k, question, category, answer, suggestion }: { k: string; question: string; category: BankCategory; answer: string; suggestion?: string }) {
  const save = useSaveAnswer();
  const [text, setText] = useState(answer);
  const dirty = text !== answer;
  const commit = (value = text) => {
    if (value === answer) return;
    save.mutate({ key: k, question, answer: value.trim(), category }, { onError: (e) => toast.error((e as Error).message) });
  };
  const Field = LONG.has(k) ? Textarea : Input;
  return (
    <div className="grid gap-1.5 py-2.5 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)] sm:items-start sm:gap-4">
      <label htmlFor={`ab-${k}`} className="pt-1.5 text-[13px] text-fg-2">
        {question}
      </label>
      <div className="space-y-1">
        <Field id={`ab-${k}`} value={text} onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setText(e.target.value)} onBlur={() => commit()} placeholder={suggestion ? `From your profile: ${suggestion}` : ""} {...(LONG.has(k) ? { rows: 3 } : {})} />
        {!text && suggestion ? (
          <button type="button" className="text-[11.5px] text-accent hover:underline" onClick={() => (setText(suggestion), commit(suggestion))}>
            Use “{suggestion.length > 40 ? `${suggestion.slice(0, 40)}…` : suggestion}”
          </button>
        ) : dirty ? (
          <span className="text-[11.5px] text-faint">Saves when you leave the field</span>
        ) : answer ? (
          <span className="inline-flex items-center gap-1 text-[11.5px] text-success">
            <Check className="h-3 w-3" /> Saved
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Jobs → Answer bank: answer once, reused in every application pack. */
export function AnswerBank({ profile }: { profile: JobProfile }) {
  const { data: rows = [], isLoading, error } = useAnswerBank();
  const { data: user } = useUser();
  const del = useDeleteAnswer();
  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error) return <p className="text-[12.5px] text-danger">Couldn&apos;t load the answer bank: {(error as Error).message}. Run supabase/migrations/0005_planning_health_chat_memory.sql.</p>;
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const custom = rows.filter((r) => r.key.startsWith("q:"));
  const filled = STANDARD_QUESTIONS.filter((q) => byKey.get(q.key)?.answer.trim()).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card className="p-4 text-[13px] text-fg-2">
        Answer these once and every <b>Prepare application</b> fills them in. {filled}/{STANDARD_QUESTIONS.length} standard answers saved
        {custom.length ? ` · ${custom.length} answer${custom.length > 1 ? "s" : ""} saved from past applications` : ""}. Facts you leave empty (pay, visa, notice period) are never guessed — they show as
        “Needs you”.
      </Card>
      {GROUPS.map((g) => {
        const qs = STANDARD_QUESTIONS.filter((q) => q.category === g.id);
        return (
          <Card key={g.id} className="px-4 py-2">
            <div className="flex items-baseline justify-between gap-2 border-b border-line py-2">
              <h3 className="text-[13px] font-medium text-fg">{g.title}</h3>
              <span className="text-[11.5px] text-faint">{g.hint}</span>
            </div>
            <div className="divide-y divide-line/60">
              {qs.map((q) => (
                <Row key={q.key} k={q.key} question={q.question} category={q.category} answer={byKey.get(q.key)?.answer ?? ""} suggestion={q.fromProfile?.(profile, user?.email)} />
              ))}
            </div>
          </Card>
        );
      })}
      {custom.length ? (
        <Card className="px-4 py-2">
          <div className="flex items-baseline justify-between gap-2 border-b border-line py-2">
            <h3 className="text-[13px] font-medium text-fg">From past applications</h3>
            <span className="text-[11.5px] text-faint">Saved when you mark an application applied</span>
          </div>
          <div className="divide-y divide-line/60">
            {custom.map((r) => (
              <div key={r.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Row k={r.key} question={r.question} category={r.category} answer={r.answer} />
                </div>
                <Tip content="Delete this answer">
                  <Button size="icon-sm" variant="ghost" className="mt-2.5 text-muted hover:text-danger" aria-label={`Delete answer to “${r.question}”`} onClick={() => del.mutate(r.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Tip>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
