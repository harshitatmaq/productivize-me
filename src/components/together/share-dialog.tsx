"use client";

import { Check, HeartHandshake, Plus, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/field";
import { useResettableState } from "@/lib/hooks";
import { useShareTo, useSpaces } from "@/lib/queries/spaces";
import { closeShare, useShareRequest } from "@/lib/share";
import { cn } from "@/lib/utils";
import { KindIcon, KIND_NAMES } from "./kind-icon";

const LAST_KEY = "share:last-spaces";
const readLast = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(LAST_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};

/** Mounted once in the app shell; opened from any "Share to…" button via openShare(). */
export function ShareDialogHost() {
  const req = useShareRequest();
  const { data: spaces = [], isLoading } = useSpaces();
  const share = useShareTo();
  // Re-pick defaults whenever a new share opens (once the dashboards have loaded).
  const source = isLoading ? null : req;
  const [picked, setPicked] = useResettableState(source, () => {
    const last = readLast().filter((id) => spaces.some((s) => s.id === id));
    return new Set(last.length ? last : spaces.length === 1 ? [spaces[0].id] : []);
  });
  const [note, setNote] = useResettableState(source, () => "");
  const [sending, setSending] = useState(false);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const send = async () => {
    if (!req || !picked.size) return;
    setSending(true);
    try {
      await share.mutateAsync({ ...req, spaceIds: [...picked], note: note.trim() || undefined });
      try {
        localStorage.setItem(LAST_KEY, JSON.stringify([...picked]));
      } catch {}
      const names = spaces.filter((s) => picked.has(s.id)).map((s) => s.name);
      toast.success(`Shared to ${names.join(", ")}`, { description: "A copy — your original stays private." });
      closeShare();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={!!req}
      onOpenChange={(o) => !o && closeShare()}
      title="Share to…"
      description="They get a copy. Your original stays private."
      size="sm"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={closeShare}>
            Cancel
          </Button>
          <Button variant="primary" onClick={send} loading={sending} disabled={!picked.size}>
            <Send className="h-4 w-4" /> Share
          </Button>
        </div>
      }
    >
      {req ? (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-xl border border-line bg-panel-2/60 p-3">
            <KindIcon kind={req.kind} className="mt-0.5" />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-faint">{KIND_NAMES[req.kind]}</div>
              <div className="line-clamp-2 text-[13.5px] text-fg">{req.title}</div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[12px] font-medium text-muted">Shared dashboards</div>
            {isLoading ? null : spaces.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-4 text-center text-[12.5px] text-muted">
                <HeartHandshake className="mx-auto mb-2 h-5 w-5 text-faint" />
                You don&apos;t have a shared dashboard yet.
                <Link href="/together?new=1" onClick={closeShare} className="mt-2 flex items-center justify-center gap-1 text-accent hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Create one and invite someone
                </Link>
              </div>
            ) : (
              <div className="space-y-1">
                {spaces.map((s) => {
                  const on = picked.has(s.id);
                  return (
                    <button
                      key={s.id}
                      onClick={() => toggle(s.id)}
                      role="checkbox"
                      aria-checked={on}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-[13px] transition-colors",
                        on ? "border-accent/50 bg-accent/10 text-fg" : "border-line text-fg-2 hover:border-line-strong",
                      )}
                    >
                      <span className="text-[16px] leading-none">{s.emoji}</span>
                      <span className="min-w-0 flex-1 truncate">{s.name}</span>
                      <span className={cn("flex h-4 w-4 items-center justify-center rounded border", on ? "border-accent bg-accent text-white" : "border-line-strong")}>
                        {on ? <Check className="h-3 w-3" /> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="Add a note (optional) — e.g. “You'd fit this one”" />
        </div>
      ) : null}
    </Dialog>
  );
}
