"use client";

import { useEffect, useRef, useState } from "react";
import { sb } from "@/lib/queries/client";
import { useSpacePeople } from "@/lib/queries/spaces";
import type {
  MessageRow,
  Pin,
  PromiseNote,
  Reaction,
  ReadState,
} from "@/lib/chat/types";
import type { Space } from "@/lib/types";
import ChatRoom from "./ChatRoom";

type Initial = {
  messages: MessageRow[];
  reactions: Reaction[];
  readState: ReadState[];
  pins: Pin[];
  promises: PromiseNote[];
  error: string | null;
};

const PAGE = 50;

/**
 * A shared dashboard's Chat and Board. Loads the opening snapshot (the latest
 * page of messages and the marks on them), then hands over to ChatRoom, which
 * keeps everything live over one realtime channel and works offline from its
 * local mirror. Identity colours apply only inside this scope.
 */
export function SpaceChat({
  space,
  me,
  view,
  onViewChange,
}: {
  space: Space;
  me: string;
  view: "chat" | "board";
  onViewChange: (v: "chat" | "board") => void;
}) {
  const { data: people } = useSpacePeople(space.id);
  const [initial, setInitial] = useState<Initial | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // On a phone the dashboard header pushes the chat below the fold; bring the
  // whole chat (header to composer) into view when it opens.

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const client = sb();
      try {
        const [m, r, rs, p, pr] = await Promise.all([
          client
            .from("chat_messages")
            .select("*")
            .eq("space_id", space.id)
            .order("created_at", { ascending: false })
            .limit(PAGE),
          client
            .from("chat_reactions")
            .select("*")
            .eq("space_id", space.id)
            .limit(5000),
          client.from("chat_read_state").select("*").eq("space_id", space.id),
          client.from("chat_pins").select("*").eq("space_id", space.id),
          client.from("chat_promises").select("*").eq("space_id", space.id),
        ]);
        const error = m.error?.message ?? r.error?.message ?? null;
        if (cancelled) return;
        setInitial({
          messages: ((m.data ?? []) as MessageRow[]).reverse(),
          reactions: (r.data ?? []) as Reaction[],
          readState: (rs.data ?? []) as ReadState[],
          pins: (p.data ?? []) as Pin[],
          promises: (pr.data ?? []) as PromiseNote[],
          error: error
            ? `${error}${/chat_|relation/.test(error) ? " — run supabase/migrations/0005_planning_health_chat_memory.sql" : ""}`
            : null,
        });
      } catch (e) {
        // Offline: the chat still opens from its local mirror.
        if (!cancelled)
          setInitial({
            messages: [],
            reactions: [],
            readState: [],
            pins: [],
            promises: [],
            error: (e as Error).message,
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [space.id]);

  const mine = people?.find((p) => p.user_id === me);
  const ready = !!(initial && people);

  // On a phone the dashboard header pushes the chat below the fold; once it has
  // loaded, bring the whole chat (header to composer) into view.
  useEffect(() => {
    if (!ready || !window.matchMedia("(max-width: 767px)").matches) return;
    const t = setTimeout(
      () => boxRef.current?.scrollIntoView({ block: "start" }),
      250,
    );
    return () => clearTimeout(t);
  }, [ready]);

  return (
    <div
      ref={boxRef}
      className={`chat-scope scroll-mt-16 who-${mine?.color ?? "slate"} relative h-[calc(100dvh-9.5rem)] min-h-[420px] overflow-hidden rounded-xl border border-line md:h-[calc(100dvh-14rem)]`}
    >
      {ready ? (
        <ChatRoom
          key={space.id}
          ctx={{
            spaceId: space.id,
            spaceName: space.name,
            me,
            people: people.map((p) => ({
              id: p.user_id,
              name: p.name,
              color: p.color ?? "slate",
            })),
          }}
          view={view}
          onViewChange={onViewChange}
          initialMessages={initial.messages}
          initialReactions={initial.reactions}
          initialReadState={initial.readState}
          initialPins={initial.pins}
          initialPromises={initial.promises}
          loadError={initial.error}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[13px] text-muted">
          Opening the chat…
        </div>
      )}
    </div>
  );
}
