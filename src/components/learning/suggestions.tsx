"use client";

import { Lightbulb, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { LearningSuggestion } from "@/app/api/learning/suggest/route";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "@/components/ui/misc";
import { useToday } from "@/lib/hooks";
import { useCreateTask } from "@/lib/queries/tasks";
import { addDays } from "@/lib/time";
import { api } from "@/lib/utils";
import { chatgptUrl } from "./ai-links";

/** Learning ideas generated from gaps in your job search. */
export function LearningSuggestions() {
  const today = useToday();
  const create = useCreateTask();
  const [items, setItems] = useState<LearningSuggestion[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<{ suggestions: LearningSuggestion[]; message?: string }>("/api/learning/suggest", { method: "POST" });
      setItems(r.suggestions);
      setMessage(r.message ?? null);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center justify-between">
        <SectionTitle className="mb-0">
          <span className="inline-flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" /> From your job search
          </span>
        </SectionTitle>
        <Button size="xs" variant="ghost" onClick={load} loading={loading}>
          {items ? "Refresh" : "Suggest"}
        </Button>
      </div>
      {!items ? (
        <p className="text-[12.5px] text-muted">Skills that keep blocking your best matches, turned into a short learning plan.</p>
      ) : items.length === 0 ? (
        <p className="text-[12.5px] text-muted">{message ?? "No gaps found yet."}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((s) => (
            <li key={s.topic} className="text-[12.5px]">
              <div className="font-medium text-fg">
                {s.topic}
                {s.evidence ? <span className="ml-1.5 font-normal text-faint">· {s.evidence} jobs</span> : null}
              </div>
              <div className="text-muted">{s.why}</div>
              <div className="mt-0.5 text-fg-2">→ {s.first_step}</div>
              <div className="mt-1.5 flex gap-3">
                <button
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                  onClick={() =>
                    create.mutate(
                      { title: `Learn: ${s.topic}`, notes: `${s.why}\nFirst step: ${s.first_step}`, due_date: addDays(today, 1), tags: ["learning"], priority: 3, estimate_minutes: 60 },
                      { onSuccess: () => toast.success("Added to tomorrow") },
                    )
                  }
                >
                  <Plus className="h-3 w-3" /> Plan it
                </button>
                <a
                  className="text-muted hover:text-fg"
                  href={chatgptUrl(`I'm preparing for ${s.topic}-heavy roles. ${s.why} Teach me the essentials in a 60-minute plan, starting with: ${s.first_step}`)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Ask ChatGPT
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
