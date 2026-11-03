"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, FileUp, Loader2, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useResettableState } from "@/lib/hooks";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { ProgressRing } from "@/components/ui/misc";
import type { ChatItem, JobProfileRow } from "@/lib/types";
import { api, cn } from "@/lib/utils";

type TurnResponse = { reply: string; done: boolean; progress: number; suggestions: string[] };

export function ScoutChat({ row, onFinalized }: { row: JobProfileRow | null | undefined; onFinalized: () => void }) {
  const qc = useQueryClient();
  // Re-sync only when the server has a different number of messages (e.g. another device).
  const [chat, setChat] = useResettableState<ChatItem[], number>(row?.chat?.length ?? 0, () => row?.chat ?? []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  const last = [...chat].reverse().find((c) => c.role === "assistant");
  const progress = last?.progress ?? 0;
  const ready = row?.status === "ready";

  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [chat.length, busy]);

  const send = async (message?: string, restart = false) => {
    if (busy) return;
    const text = message?.trim();
    if (text) setChat((c) => [...c, { role: "user", content: text, at: new Date().toISOString() }]);
    if (restart) setChat([]);
    setInput("");
    setBusy(true);
    try {
      const r = await api<TurnResponse>("/api/jobs/onboard", { json: { message: text, restart } });
      setChat((c) => [...c, { role: "assistant", content: r.reply, progress: r.progress, suggestions: r.suggestions }]);
      if (r.done) setDone(true);
      qc.invalidateQueries({ queryKey: ["job-profile"] });
    } catch (e) {
      toast.error((e as Error).message);
      setChat((c) => c.filter((x) => x.content !== text || x.role !== "user"));
      if (text) setInput(text);
    } finally {
      setBusy(false);
    }
  };

  // Kick off the interview the first time.
  useEffect(() => {
    if (row !== undefined && !started.current && (row?.chat ?? []).length === 0) {
      started.current = true;
      send();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{ chars: number }>("/api/resume/parse", { method: "POST", body: fd });
      toast.success(`Resume read (${Math.round(r.chars / 100) / 10}k characters)`);
      await send(`I've uploaded my resume (${file.name}). Please read it, tell me what you understood and ask only about what's missing.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const finalize = async () => {
    setFinalizing(true);
    try {
      await api("/api/jobs/profile", { json: { action: "finalize" } });
      toast.success("Profile ready — your first job search is running now");
      qc.invalidateQueries({ queryKey: ["job-profile"] });
      setTimeout(() => qc.invalidateQueries({ queryKey: ["jobs"] }), 45_000);
      onFinalized();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFinalizing(false);
    }
  };

  const suggestions = !busy && last?.suggestions?.length && chat[chat.length - 1]?.role === "assistant" ? last.suggestions : [];

  return (
    <div className="flex h-[min(72dvh,760px)] flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <ProgressRing value={progress / 100} size={34} stroke={3}>
          <Sparkles className="h-3.5 w-3.5 text-accent" />
        </ProgressRing>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium text-fg">Scout · your job-search agent</div>
          <div className="text-[12px] text-muted">{ready ? "Profile ready · keep chatting to refine it" : `Profile ${progress}% complete`}</div>
        </div>
        <Button size="icon-sm" variant="ghost" title="Restart interview" onClick={() => send(undefined, true)} disabled={busy}>
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {chat.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed",
                m.role === "user" ? "rounded-br-md bg-accent text-white" : "rounded-bl-md border border-line bg-panel-2 text-fg-2",
              )}
            >
              {m.role === "assistant" ? <Markdown text={m.content} /> : <span className="whitespace-pre-wrap">{m.content}</span>}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="flex items-center gap-2 text-[12.5px] text-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scout is thinking…
          </div>
        ) : null}
        <div ref={bottom} />
      </div>

      {(done || progress >= 60) && !ready ? (
        <div className="mx-4 mb-2 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-3 py-2.5 animate-fade-in">
          <Wand2 className="h-4 w-4 text-accent" />
          <span className="min-w-0 flex-1 text-[12.5px] text-fg-2">Scout has enough to start searching. You can keep refining later.</span>
          <Button size="sm" variant="primary" onClick={finalize} loading={finalizing}>
            Build my profile & start searching
          </Button>
        </div>
      ) : null}

      {suggestions.length ? (
        <div className="flex gap-1.5 overflow-x-auto px-4 pb-2 no-scrollbar">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="shrink-0 rounded-full border border-line-strong px-3 py-1 text-[12px] text-fg-2 transition-colors hover:border-accent hover:text-fg"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <div className="border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-xl border border-line bg-panel-2 p-1.5 focus-within:border-accent/60">
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
          <Button size="icon" variant="ghost" title="Upload resume (PDF)" onClick={() => fileRef.current?.click()} loading={uploading}>
            {!uploading ? <FileUp className="h-4 w-4" /> : null}
          </Button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Answer Scout, paste your resume, or ask for changes…"
            className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-[13.5px] text-fg outline-none placeholder:text-faint"
          />
          <Button size="icon" variant="primary" onClick={() => send(input)} disabled={!input.trim() || busy} aria-label="Send">
            <ArrowUp className="h-4 w-4" />
          </Button>
        </div>
        {ready ? (
          <div className="mt-2 flex justify-end">
            <Button size="xs" variant="ghost" onClick={finalize} loading={finalizing}>
              <Wand2 className="h-3 w-3" /> Rebuild profile from this chat
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
