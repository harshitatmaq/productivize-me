import { NextRequest, NextResponse } from "next/server";
import { chat, LlmChainError } from "@/lib/ai/llm";
import type { HttpError } from "@/lib/auth";
import { executeOps } from "@/lib/chat/chatExec";
import {
  addDaysISO,
  buildLayout,
  dayIn,
  describeProposal,
  planActions,
  renderBoards,
  safeZone,
  weekdayOf,
  type LayoutHint,
  type PlanItem,
} from "@/lib/chat/chatPlan";
import { signProposal } from "@/lib/chat/chatProposal";
import { proposalSecret, requireMember } from "@/lib/chat/server";

export const maxDuration = 90;


const ACTION_TOOL = "perform_workspace_actions";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Only plain user/assistant text is accepted from the browser. Anything else —
 * a "system" turn, a tool turn — would let a request rewrite the instructions
 * the assistant is running under.
 */
function cleanHistory(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (t): t is Turn =>
        !!t &&
        typeof t === "object" &&
        ((t as Turn).role === "user" || (t as Turn).role === "assistant") &&
        typeof (t as Turn).content === "string"
    )
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.content.slice(0, 6000) }));
}

/** What the person's screen reports about how the boards are laid out. */
function cleanLayout(raw: unknown): LayoutHint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const input = raw as { noteColumns?: unknown; order?: unknown };
  const hint: LayoutHint = {};

  if (typeof input.noteColumns === "number") hint.noteColumns = input.noteColumns;

  if (input.order && typeof input.order === "object") {
    const order: NonNullable<LayoutHint["order"]> = {};
    for (const kind of ["note", "task", "discuss", "shop"] as const) {
      const ids = (input.order as Record<string, unknown>)[kind];
      if (Array.isArray(ids)) {
        order[kind] = ids
          .filter((id): id is string => typeof id === "string" && id.length <= 80)
          .slice(0, 500);
      }
    }
    hint.order = order;
  }
  return hint;
}

interface ToolMessage {
  content?: string | null;
  tool_calls?: { function?: { name?: string; arguments?: string } }[];
}

function extractActions(message: ToolMessage | undefined): {
  actions: unknown[];
  unreadable: boolean;
} {
  const actions: unknown[] = [];
  let unreadable = false;

  for (const call of message?.tool_calls ?? []) {
    if (call.function?.name !== ACTION_TOOL) continue;
    try {
      const args = JSON.parse(call.function.arguments ?? "");
      if (Array.isArray(args?.actions)) actions.push(...args.actions);
      else unreadable = true;
    } catch {
      unreadable = true;
    }
  }

  // Some models write the plan as a fenced block instead of calling the tool.
  if (actions.length === 0 && !unreadable) {
    const fenced = (message?.content ?? "").match(/```actions\s*\n([\s\S]*?)\n```/);
    if (fenced) {
      try {
        const parsed = JSON.parse(fenced[1]);
        const list = Array.isArray(parsed) ? parsed : parsed?.actions;
        if (Array.isArray(list)) actions.push(...list);
        else unreadable = true;
      } catch {
        unreadable = true;
      }
    }
  }

  return { actions, unreadable };
}

/**
 * Workspace assistant.
 *
 * Reads the board as the signed-in person, asks the model what to do, and
 * carries out the safe parts. Anything that deletes is *not* carried out here:
 * it comes back as a proposal for the person to approve with a button, and is
 * only run by `/api/chat/confirm`.
 */
export async function POST(req: NextRequest) {
  // Authenticate first, before the body is even read. This route used to run
  // with the service-role key and no check at all, so anyone who could reach the
  // URL could read the workspace or change it.
  let body: {
    message?: unknown;
    history?: unknown;
    layout?: unknown;
    remindersOnly?: unknown;
    tz?: unknown;
    spaceId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  // Signed in, and a member of this dashboard.
  let member;
  try {
    member = await requireMember(body.spaceId);
  } catch (e) {
    const err = e as HttpError;
    return NextResponse.json({ error: err.message }, { status: err.status ?? 401 });
  }
  const uid = member.user.id;
  const spaceId = member.spaceId;

  try {
    // As the signed-in person, so row level security applies to everything the
    // assistant reads or writes.
    const supabase = member.supabase;

    // "Today" is the person's today, not the server's: the server runs in UTC,
    // which is a different calendar day for hours of every day almost anywhere.
    const tz = safeZone(body.tz);

    // Today's reminders, with no model involved.
    //
    // The panel used to ask the model "what's planned today?" every time it was
    // opened. That spent about half of the per-minute token budget on a greeting
    // nobody asked for — so the first real command typed right after opening
    // was usually rate-limited — and sent the whole workspace to the AI provider
    // on every open. The reminders are just rows; they don't need a model.
    if (body.remindersOnly === true) {
      const { data: events, error: eventsError } = await supabase
        .from("board_items")
        .select("client_id,title,due_at")
        .eq("space_id", spaceId)
        .eq("kind", "event")
        .is("deleted_at", null);

      if (eventsError) {
        return NextResponse.json(
          { error: `Couldn't read the workspace: ${eventsError.message}` },
          { status: 502 }
        );
      }

      const today = dayIn(new Date(), tz);
      return NextResponse.json({
        reminders: (events ?? [])
          .filter((e) => e.due_at && dayIn(e.due_at, tz) === today)
          .map((e) => ({ title: e.title, client_id: e.client_id })),
      });
    }

    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) {
      return NextResponse.json({ error: "Say something first." }, { status: 400 });
    }
    if (message.length > 4000) {
      return NextResponse.json({ error: "That message is too long." }, { status: 400 });
    }

    const history = cleanHistory(body.history);
    const last = history[history.length - 1];
    // The question always reaches the model, even from a caller that sent it
    // only as `message` and left the history empty.
    if (!last || last.role !== "user" || last.content !== message) {
      history.push({ role: "user", content: message });
    }

    const { data: rows, error: loadError } = await supabase
      .from("board_items")
      .select("*")
      .eq("space_id", spaceId)
      .is("deleted_at", null)
      .order("position", { ascending: true });

    if (loadError) {
      return NextResponse.json(
        { error: `Couldn't read the workspace: ${loadError.message}` },
        { status: 502 }
      );
    }

    const items = (rows ?? []) as PlanItem[];
    const byId = new Map(items.map((i) => [i.client_id, i]));
    const layout = buildLayout(items, cleanLayout(body.layout));
    const { data: people } = await supabase.rpc("space_people", { p_space: spaceId });
    const names: Record<string, string> = Object.fromEntries(
      ((people ?? []) as { user_id: string; name: string }[]).map((p) => [p.user_id, p.name])
    );
    const others = Object.entries(names)
      .filter(([id]) => id !== uid)
      .map(([, n]) => n);

    const todayISO = dayIn(new Date(), tz);
    const dayOfWeek = weekdayOf(todayISO, "long");

    const todayEvents = items.filter(
      (e) => e.kind === "event" && e.due_at && dayIn(e.due_at, tz) === todayISO
    );

    // A 30-day reference so smaller models can resolve relative dates reliably.
    const next30Days = Array.from({ length: 30 }).map((_, i) => {
      const day = addDaysISO(todayISO, i);
      return `${weekdayOf(day)} ${day}`;
    });

    const systemPrompt = `You are the assistant inside a shared dashboard in Productivize. You are talking to ${member.name}; ${others.length ? `the others here are ${others.join(", ")}` : "nobody else has joined yet"}. Each item is credited to whoever created or last edited it.

Today is ${dayOfWeek}, ${todayISO}.

### Date Reference (Next 30 Days)
${next30Days.join(", ")}

## Current Workspace
${renderBoards(items, layout, names, tz)}
${todayEvents.length > 0 ? `\n### 🔔 TODAY'S REMINDERS:\n${todayEvents.map((e) => `- ${e.title}`).join("\n")}` : ""}

## How to change things
You change the workspace only by calling the \`${ACTION_TOOL}\` tool. Call it only when the user asks for a change.

Referring to items:
- The Notes board is a grid. Each note is labelled R<row>C<col>, 1-based: R3C2 is the third row, second column. List items are labelled #<n>.
- When the user points at a position ("the note on the 3rd row and 2nd column"), find that label in the lists above and use that item. Do not work positions out yourself, and never invent an id.
- Name an item in an action by its exact client_id, or by kind plus row (plus col for notes).

Actions:
- add: new item. Give kind and title. For calendar entries add due_at (YYYY-MM-DD). For meals add meta {"date": "YYYY-MM-DD", "slot": "breakfast|lunch|dinner"}. For a recurring event ("every Tuesday") add individual entries for the next 4 weeks.
- update: change an item's title, due_at or done.
- toggle: flip an item's done state.
- remove: delete an item.
- split: turn one note or list item into several. Put each resulting text in "parts", in order, applying exactly the format the user asked for and otherwise keeping their wording. The original is deleted once the user approves; set keep_original to true only if they want to keep it. Never split or rewrite an item marked [TRUNCATED] — tell the user it is too long instead.

Deleting is never immediate. For remove, and for split without keep_original, the app shows the user an Approve / Cancel button and nothing changes until they press it. So word your reply as a request ("I'll delete … once you confirm"), never as something already done.

Be friendly and concise. If today has calendar events, remind the user.
Do not call the tool if no workspace change is needed.`;

    // Productivize's AI chain (Groq → … → MAQ), with the same tool contract.
    let result;
    try {
      result = await chat({
        purpose: "dashboard-assistant",
        messages: [{ role: "system", content: systemPrompt }, ...history],
        // Low: this is lookups and exact copying, not creative writing.
        temperature: 0.2,
        // Room for a long split. Too small and the tool call is cut off mid-JSON.
        maxTokens: 4096,
        deadlineMs: 70_000,
        toolChoice: "auto",
        tools: [
          {
            type: "function",
            function: {
              name: ACTION_TOOL,
              description:
                "Add, edit, tick, split or delete workspace items. Deletions (remove, and split without keep_original) are held until the user approves them.",
              parameters: {
                type: "object",
                properties: {
                  actions: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        action: {
                          type: "string",
                          enum: ["add", "update", "toggle", "remove", "split"],
                        },
                        kind: {
                          type: "string",
                          enum: ["note", "task", "discuss", "shop", "meal", "event"],
                        },
                        title: { type: "string" },
                        due_at: { type: "string", description: "ISO date or datetime" },
                        client_id: { type: "string" },
                        row: {
                          type: "integer",
                          description: "1-based row of the item on its board",
                        },
                        col: {
                          type: "integer",
                          description: "1-based column; the Notes grid only",
                        },
                        done: { type: "boolean" },
                        meta: { type: "object" },
                        parts: {
                          type: "array",
                          items: { type: "string" },
                          description: "split: the text of each new item, in order",
                        },
                        keep_original: { type: "boolean" },
                      },
                      required: ["action"],
                    },
                  },
                },
                required: ["actions"],
              },
            },
          },
        ],
      });
    } catch (e) {
      console.error("Assistant error:", (e as Error).message.slice(0, 500));
      const limited = e instanceof LlmChainError && e.attempts.some((a) => /429|cooling/.test(a.error ?? ""));
      return NextResponse.json(
        { error: limited ? "The AI services are rate-limited right now. Try again in a minute." : "The AI service didn't answer. Try again in a moment." },
        { status: 502 }
      );
    }

    const choice = { finish_reason: result.finishReason };
    const modelMessage: ToolMessage = { content: result.text, tool_calls: result.toolCalls };
    const modelText = (modelMessage.content ?? "")
      .replace(/```actions\s*\n[\s\S]*?\n```/g, "")
      .trim();

    const { actions, unreadable } = extractActions(modelMessage);
    const plan = planActions(actions, { items, layout, now: Date.now(), tz });

    if (unreadable) {
      plan.problems.push(
        choice?.finish_reason === "length"
          ? "My reply was cut off before I finished, so I didn't change anything. Try a smaller request."
          : "I couldn't read my own action plan, so I didn't change anything. Please try rephrasing."
      );
    }

    // Safe changes run now, as the signed-in person.
    const executed =
      plan.immediate.length > 0
        ? await executeOps(supabase, uid, spaceId, plan.immediate)
        : { done: [], failed: [] };

    // Anything that deletes waits for a button press.
    let proposal:
      | (ReturnType<typeof describeProposal> & { token: string; expiresAt: number })
      | null = null;

    if (plan.guarded.length > 0) {
      const secret = proposalSecret();
      if (!secret) {
        plan.problems.push("Approvals aren't set up on the server, so I didn't delete anything.");
      } else {
        const { token, expiresAt } = await signProposal(secret, uid, plan.guarded, Date.now(), spaceId);
        proposal = {
          token,
          expiresAt,
          ...describeProposal(plan.guarded, byId, layout),
        };
      }
    }

    const reply =
      modelText ||
      (proposal
        ? "Here's what I'm about to change — please confirm below."
        : executed.done.length > 0
          ? "I've updated the workspace for you!"
          : plan.problems.length > 0
            ? ""
            : "I couldn't generate a response.");

    return NextResponse.json({
      reply,
      actions: executed.done,
      problems: [...plan.problems, ...executed.failed],
      proposal,
      reminders: todayEvents.map((e) => ({ title: e.title, client_id: e.client_id })),
    });
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
