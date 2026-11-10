"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { ShareKind, Space, SpaceComment, SpaceInvite, SpaceItem, SpaceList, SpaceListItem, SpacePerson, SpaceReaction } from "@/lib/types";
import { api } from "@/lib/utils";
import { sb, unwrap } from "./client";
import { useUser } from "./profile";

const k = {
  spaces: ["spaces"] as const,
  invites: ["space-invites"] as const,
  people: (id: string) => ["space-people", id] as const,
  items: (id: string) => ["space-items", id] as const,
  comments: (id: string) => ["space-comments", id] as const,
  reactions: (id: string) => ["space-reactions", id] as const,
  lists: (id: string) => ["space-lists", id] as const,
  listItems: (id: string) => ["space-list-items", id] as const,
  spaceInvites: (id: string) => ["space-invites", id] as const,
};

export function useSpaces() {
  return useQuery({
    queryKey: k.spaces,
    queryFn: async () => {
      const { data: me } = await sb().auth.getUser();
      const [spaces, members] = await Promise.all([
        sb().from("spaces").select("*").order("created_at"),
        sb().from("space_members").select("space_id").eq("user_id", me.user?.id ?? ""),
      ]);
      const mine = new Set((unwrap(members) as { space_id: string }[]).map((m) => m.space_id));
      // spaces also returns ones you're only invited to; keep the ones you've joined.
      return (unwrap(spaces) as Space[]).filter((s) => mine.has(s.id));
    },
  });
}

/** Invites addressed to me (pending), with the space name. */
export function useMyInvites() {
  const { data: user } = useUser();
  const email = user?.email?.toLowerCase();
  return useQuery({
    queryKey: [...k.invites, email],
    enabled: !!email,
    queryFn: async () => {
      const invites = unwrap(await sb().from("space_invites").select("*").eq("status", "pending").eq("email", email!)) as SpaceInvite[];
      if (!invites.length) return [];
      const spaces = unwrap(await sb().from("spaces").select("*").in("id", invites.map((i) => i.space_id))) as Space[];
      return invites.map((i) => ({ ...i, space: spaces.find((s) => s.id === i.space_id) })).filter((i) => i.space) as (SpaceInvite & { space: Space })[];
    },
    refetchInterval: 5 * 60_000,
  });
}

export function useSpacePeople(spaceId: string | null) {
  return useQuery({
    queryKey: k.people(spaceId ?? ""),
    enabled: !!spaceId,
    queryFn: async () => unwrap(await sb().rpc("space_people", { p_space: spaceId })) as SpacePerson[],
  });
}

export function usePendingSpaceInvites(spaceId: string | null) {
  return useQuery({
    queryKey: k.spaceInvites(spaceId ?? ""),
    enabled: !!spaceId,
    queryFn: async () => unwrap(await sb().from("space_invites").select("*").eq("space_id", spaceId!).eq("status", "pending").order("created_at")) as SpaceInvite[],
  });
}

export function useSpaceItems(spaceId: string | null) {
  return useQuery({
    queryKey: k.items(spaceId ?? ""),
    enabled: !!spaceId,
    queryFn: async () => unwrap(await sb().from("space_items").select("*").eq("space_id", spaceId!).order("created_at", { ascending: false }).limit(300)) as SpaceItem[],
  });
}

export function useSpaceComments(spaceId: string | null) {
  return useQuery({
    queryKey: k.comments(spaceId ?? ""),
    enabled: !!spaceId,
    queryFn: async () => unwrap(await sb().from("space_comments").select("*").eq("space_id", spaceId!).order("created_at").limit(1000)) as SpaceComment[],
  });
}

export function useSpaceReactions(spaceId: string | null) {
  return useQuery({
    queryKey: k.reactions(spaceId ?? ""),
    enabled: !!spaceId,
    queryFn: async () => unwrap(await sb().from("space_reactions").select("*").eq("space_id", spaceId!)) as SpaceReaction[],
  });
}

export function useSpaceLists(spaceId: string | null) {
  return useQuery({
    queryKey: k.lists(spaceId ?? ""),
    enabled: !!spaceId,
    queryFn: async () => unwrap(await sb().from("space_lists").select("*").eq("space_id", spaceId!).order("sort").order("created_at")) as SpaceList[],
  });
}

export function useSpaceListItems(spaceId: string | null) {
  return useQuery({
    queryKey: k.listItems(spaceId ?? ""),
    enabled: !!spaceId,
    queryFn: async () => unwrap(await sb().from("space_list_items").select("*").eq("space_id", spaceId!).order("sort").order("created_at")) as SpaceListItem[],
  });
}

/** Live updates for everything inside one shared dashboard. */
export function useSpaceRealtime(spaceId: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!spaceId) return;
    const client = sb();
    const tables: [string, readonly unknown[]][] = [
      ["space_items", k.items(spaceId)],
      ["space_comments", k.comments(spaceId)],
      ["space_reactions", k.reactions(spaceId)],
      ["space_lists", k.lists(spaceId)],
      ["space_list_items", k.listItems(spaceId)],
      ["space_members", k.people(spaceId)],
      ["space_invites", k.spaceInvites(spaceId)],
    ];
    let channel = client.channel(`space-${spaceId}`);
    for (const [table, key] of tables) {
      channel = channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `space_id=eq.${spaceId}` }, () =>
        qc.invalidateQueries({ queryKey: key }),
      );
    }
    channel.subscribe();
    // Fallback when Realtime isn't enabled: refresh every 30s while the dashboard is open.
    const t = setInterval(() => tables.forEach(([, key]) => qc.invalidateQueries({ queryKey: key })), 30_000);
    return () => {
      clearInterval(t);
      client.removeChannel(channel);
    };
  }, [spaceId, qc]);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { name: string; emoji: string }) => unwrap(await sb().from("spaces").insert(v).select("*").single()) as Space,
    onSuccess: (s) => qc.setQueryData<Space[]>(k.spaces, (prev) => [...(prev ?? []), s]),
  });
}

export function useUpdateSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Pick<Space, "name" | "emoji">> }) =>
      unwrap(await sb().from("spaces").update(patch).eq("id", id).select("*").single()) as Space,
    onSuccess: (s) => qc.setQueryData<Space[]>(k.spaces, (prev) => prev?.map((x) => (x.id === s.id ? s : x))),
  });
}

export function useDeleteSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => unwrap(await sb().from("spaces").delete().eq("id", id)),
    onSuccess: (_d, id) => qc.setQueryData<Space[]>(k.spaces, (prev) => prev?.filter((x) => x.id !== id)),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ spaceId, userId }: { spaceId: string; userId: string }) =>
      unwrap(await sb().from("space_members").delete().eq("space_id", spaceId).eq("user_id", userId)),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: k.people(v.spaceId) });
      qc.invalidateQueries({ queryKey: k.spaces });
    },
  });
}

/** Picks your identity colour in a dashboard (the database refuses a taken one). */
export function useSetMyColor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ spaceId, color }: { spaceId: string; color: string }) => {
      const { data: me } = await sb().auth.getUser();
      return unwrap(await sb().from("space_members").update({ color }).eq("space_id", spaceId).eq("user_id", me.user!.id));
    },
    onSettled: (_d, _e, v) => qc.invalidateQueries({ queryKey: k.people(v.spaceId) }),
  });
}

export type InviteResponse = { status: "emailed" | "notified" | "link"; link?: string; newAccount: boolean; resend: boolean };

export function useInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { spaceId: string; email: string }) => api<InviteResponse>("/api/spaces/invite", { json: v }),
    onSuccess: (_r, v) => qc.invalidateQueries({ queryKey: k.spaceInvites(v.spaceId) }),
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (inv: SpaceInvite) => unwrap(await sb().from("space_invites").update({ status: "revoked" }).eq("id", inv.id)),
    onSuccess: (_d, inv) => qc.invalidateQueries({ queryKey: k.spaceInvites(inv.space_id) }),
  });
}

export function useAnswerInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) =>
      accept ? (unwrap(await sb().rpc("accept_space_invite", { p_invite: id })) as string) : (unwrap(await sb().rpc("decline_space_invite", { p_invite: id })), null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: k.invites });
      qc.invalidateQueries({ queryKey: k.spaces });
      qc.invalidateQueries({ queryKey: ["buddy"] });
    },
  });
}

export type ShareInput = {
  kind: ShareKind;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown>;
  sourceId?: string | null;
};

/** Share a copy of something into one or more dashboards (members get notified). */
export function useShareTo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ShareInput & { spaceIds: string[]; note?: string }) => api<{ ok: true; items: SpaceItem[] }>("/api/spaces/share", { json: v }),
    onSuccess: (_r, v) => v.spaceIds.forEach((id) => qc.invalidateQueries({ queryKey: k.items(id) })),
  });
}

export function useUpdateSpaceItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, patch }: { item: SpaceItem; patch: Partial<Pick<SpaceItem, "done" | "status" | "title" | "note">> }) =>
      unwrap(await sb().from("space_items").update(patch).eq("id", item.id).select("*").single()) as SpaceItem,
    onMutate: ({ item, patch }) => {
      qc.setQueryData<SpaceItem[]>(k.items(item.space_id), (prev) => prev?.map((x) => (x.id === item.id ? { ...x, ...patch } : x)));
    },
    onSettled: (_d, _e, { item }) => qc.invalidateQueries({ queryKey: k.items(item.space_id) }),
  });
}

export function useDeleteSpaceItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: SpaceItem) => {
      const { error, count } = await sb().from("space_items").delete({ count: "exact" }).eq("id", item.id);
      if (error) throw new Error(error.message);
      if (!count) throw new Error("Only the person who shared it (or the dashboard owner) can remove it.");
    },
    onSuccess: (_d, item) => qc.setQueryData<SpaceItem[]>(k.items(item.space_id), (prev) => prev?.filter((x) => x.id !== item.id)),
  });
}

export function useAddComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { item: SpaceItem; body: string }) => api("/api/spaces/comment", { json: { itemId: v.item.id, body: v.body } }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: k.comments(v.item.space_id) }),
  });
}

export function useDeleteComment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: SpaceComment) => unwrap(await sb().from("space_comments").delete().eq("id", c.id)),
    onSuccess: (_d, c) => qc.setQueryData<SpaceComment[]>(k.comments(c.space_id), (prev) => prev?.filter((x) => x.id !== c.id)),
  });
}

export function useToggleReaction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, emoji, mine }: { item: SpaceItem; emoji: string; mine: boolean; userId: string }) =>
      mine
        ? unwrap(await sb().from("space_reactions").delete().eq("item_id", item.id).eq("emoji", emoji).eq("user_id", (await sb().auth.getUser()).data.user!.id))
        : unwrap(await sb().from("space_reactions").insert({ item_id: item.id, space_id: item.space_id, emoji })),
    onMutate: ({ item, emoji, mine, userId }) => {
      qc.setQueryData<SpaceReaction[]>(k.reactions(item.space_id), (prev) =>
        mine
          ? prev?.filter((r) => !(r.item_id === item.id && r.emoji === emoji && r.user_id === userId))
          : [...(prev ?? []), { item_id: item.id, space_id: item.space_id, user_id: userId, emoji, created_at: new Date().toISOString() }],
      );
    },
    onSettled: (_d, _e, { item }) => qc.invalidateQueries({ queryKey: k.reactions(item.space_id) }),
  });
}

export function useAddList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { spaceId: string; title: string }) =>
      unwrap(await sb().from("space_lists").insert({ space_id: v.spaceId, title: v.title, sort: Date.now() / 1e6 }).select("*").single()) as SpaceList,
    onSuccess: (l) => qc.setQueryData<SpaceList[]>(k.lists(l.space_id), (prev) => [...(prev ?? []), l]),
  });
}

export function useUpdateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ list, title }: { list: SpaceList; title: string }) => unwrap(await sb().from("space_lists").update({ title }).eq("id", list.id)),
    onSuccess: (_d, { list }) => qc.invalidateQueries({ queryKey: k.lists(list.space_id) }),
  });
}

export function useDeleteList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (list: SpaceList) => unwrap(await sb().from("space_lists").delete().eq("id", list.id)),
    onSuccess: (_d, list) => qc.setQueryData<SpaceList[]>(k.lists(list.space_id), (prev) => prev?.filter((x) => x.id !== list.id)),
  });
}

export function useAddListItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { list: SpaceList; text: string }) =>
      unwrap(await sb().from("space_list_items").insert({ list_id: v.list.id, space_id: v.list.space_id, text: v.text, sort: Date.now() / 1e6 }).select("*").single()) as SpaceListItem,
    onSuccess: (it) => qc.setQueryData<SpaceListItem[]>(k.listItems(it.space_id), (prev) => [...(prev ?? []), it]),
  });
}

export function useUpdateListItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ item, patch }: { item: SpaceListItem; patch: Partial<Pick<SpaceListItem, "done" | "text">> }) =>
      unwrap(await sb().from("space_list_items").update(patch).eq("id", item.id).select("*").single()) as SpaceListItem,
    onMutate: ({ item, patch }) => qc.setQueryData<SpaceListItem[]>(k.listItems(item.space_id), (prev) => prev?.map((x) => (x.id === item.id ? { ...x, ...patch } : x))),
    onSettled: (_d, _e, { item }) => qc.invalidateQueries({ queryKey: k.listItems(item.space_id) }),
  });
}

export function useDeleteListItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (item: SpaceListItem) => unwrap(await sb().from("space_list_items").delete().eq("id", item.id)),
    onMutate: (item) => qc.setQueryData<SpaceListItem[]>(k.listItems(item.space_id), (prev) => prev?.filter((x) => x.id !== item.id)),
  });
}
