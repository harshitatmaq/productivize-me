import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractJson } from "@/lib/ai/json";
import { __setFetch, chat, chatJson, classifyFailure, LlmChainError } from "@/lib/ai/llm";

const ENV_KEYS = ["GROQ_API_KEY", "CEREBRAS_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "MAQ_AI_API_KEY", "MAQ_AI_BASE_URL", "MAQ_AI_MODELS", "LLM_PROVIDER_ORDER", "GROQ_MODELS", "GEMINI_MODELS", "NVIDIA_API_KEY", "CLOUDFLARE_API_KEY", "CLOUDFLARE_ACCOUNT_ID", "LLM_PURPOSE_LANES", "LLM_LANE_QUICK", "LLM_PURPOSE_FIRST", "LLM_NO_PERSONAL_DATA", "GROQ_MAX_REQUEST_TOKENS"];
const saved: Record<string, string | undefined> = {};

function reply(content: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : content, {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __setFetch(null);
});

describe("extractJson", () => {
  it("handles fences, prose, think blocks and trailing commas", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here you go: {"a": {"b": "x}y"},} hope that helps')).toEqual({ a: { b: "x}y" } });
    expect(extractJson('<think>hmm {"no":1}</think>[1,2,]')).toEqual([1, 2]);
  });
});

describe("LLM fallback chain", () => {
  it("errors clearly when nothing is configured", async () => {
    await expect(chat({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(LlmChainError);
  });

  it("falls back across models and providers, keeping MAQ last", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GROQ_MODELS = "m1,m2";
    process.env.CEREBRAS_API_KEY = "c";
    process.env.MAQ_AI_API_KEY = "q";
    process.env.MAQ_AI_BASE_URL = "https://maq.example/v1";
    process.env.MAQ_AI_MODELS = "slm";
    const calls: string[] = [];
    __setFetch(async (url, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push(`${String(url).split("/")[2]}:${body.model}`);
      if (String(url).includes("groq")) return reply("rate limited", 429, { "retry-after": "30" });
      if (String(url).includes("cerebras")) return reply("boom", 503);
      return reply("from maq");
    });
    const r = await chat({ messages: [{ role: "user", content: "hi" }] });
    expect(r.text).toBe("from maq");
    expect(r.provider).toBe("maq");
    expect(calls[0]).toBe("api.groq.com:m1");
    expect(calls[1]).toBe("api.groq.com:m2");
    expect(calls.at(-1)).toBe("maq.example:slm");

    // groq models are now cooling down and are skipped without a request
    calls.length = 0;
    await chat({ messages: [{ role: "user", content: "again" }] });
    expect(calls.some((c) => c.startsWith("api.groq.com"))).toBe(false);
  });

  it("moves on when a model returns invalid JSON", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GROQ_MODELS = "bad,good";
    __setFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return reply(body.model === "bad" ? "not json at all" : '{"ok":true}');
    });
    const r = await chatJson<{ ok: boolean }>({ messages: [{ role: "user", content: "hi" }] });
    expect(r.data.ok).toBe(true);
    expect(r.model).toBe("good");
  });

  it("retries without response_format when JSON mode is rejected", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GROQ_MODELS = "m";
    const seen: boolean[] = [];
    __setFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      seen.push("response_format" in body);
      if (body.response_format) return reply('{"error":"response_format not supported"}', 400);
      return reply('{"x":2}');
    });
    const r = await chatJson<{ x: number }>({ messages: [{ role: "user", content: "hi" }] });
    expect(r.data.x).toBe(2);
    expect(seen).toEqual([true, false]);
  });
});

describe("smarter fallback", () => {
  const msg = (content = "hi") => ({ messages: [{ role: "user" as const, content }] });
  const host = (url: unknown) => String(url).split("/")[2];

  it("tells per-minute limits, daily limits and retired models apart", () => {
    const now = Date.UTC(2026, 10, 11, 10, 0, 0);
    expect(classifyFailure(429, "Rate limit reached for requests per minute", 20_000, now)).toEqual({ until: now + 20_000, kind: "minute" });
    const daily = classifyFailure(429, "Rate limit reached for model on tokens per day (TPD): Limit 200000", undefined, now);
    expect(daily.kind).toBe("daily");
    expect(daily.until).toBeGreaterThanOrEqual(Date.UTC(2026, 10, 12));
    expect(classifyFailure(404, "The model `llama-3.3-70b-versatile` does not exist", undefined, now).kind).toBe("retired");
    expect(classifyFailure(400, "model_not_found: decommissioned", undefined, now).kind).toBe("retired");
    expect(classifyFailure(400, "bad request: messages missing", undefined, now).kind).toBe("other");
  });

  it("stops calling a retired model and a model whose daily limit is used up", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GROQ_MODELS = "dead,tired,ok";
    const calls: string[] = [];
    __setFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.model);
      if (body.model === "dead") return reply('{"error":{"message":"The model `dead` does not exist"}}', 404);
      if (body.model === "tired") return reply("Rate limit reached on requests per day (RPD)", 429);
      return reply("fine");
    });
    expect((await chat(msg())).model).toBe("ok");
    calls.length = 0;
    expect((await chat(msg())).model).toBe("ok");
    expect(calls).toEqual(["ok"]);
  });

  it("skips Groq for requests too big for its free per-minute budget", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GROQ_MODELS = "m";
    process.env.MAQ_AI_API_KEY = "q";
    process.env.MAQ_AI_BASE_URL = "https://maq.example/v1";
    process.env.MAQ_AI_MODELS = "slm";
    const hosts: string[] = [];
    __setFetch(async (url) => {
      hosts.push(host(url));
      return reply("ok");
    });
    const r = await chat({ ...msg("x".repeat(30_000)), maxTokens: 3000 });
    expect(r.provider).toBe("maq");
    expect(hosts).toEqual(["maq.example"]);
    expect(r.attempts[0].error).toMatch(/too large/);
  });

  it("gives a model one chance to repair broken JSON before moving on", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GROQ_MODELS = "first,second";
    const calls: string[] = [];
    __setFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body.model);
      const repairing = body.messages.length > 1;
      return reply(body.model === "first" && !repairing ? '{"ok": tru' : '{"ok":true}');
    });
    const r = await chatJson<{ ok: boolean }>(msg());
    expect(r.model).toBe("first");
    expect(calls).toEqual(["first", "first"]);
  });

  it("uses a task's own lane, can move one model to the front, and keeps personal data away from listed providers", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GROQ_MODELS = "big,small";
    process.env.GEMINI_API_KEY = "m";
    process.env.GEMINI_MODELS = "flash";
    process.env.LLM_PURPOSE_LANES = "job-query:quick,plan-day:quick";
    process.env.LLM_LANE_QUICK = "gemini:flash,groq:big";
    process.env.LLM_PURPOSE_FIRST = "job-query:groq:small";
    process.env.LLM_NO_PERSONAL_DATA = "gemini";
    const calls: string[] = [];
    __setFetch(async (url, init) => {
      calls.push(`${host(url)}:${JSON.parse(String(init?.body)).model}`);
      return reply("nope", 503);
    });
    await expect(chat({ ...msg(), purpose: "job-query" })).rejects.toBeInstanceOf(LlmChainError);
    // public task: front model first, then the lane (gemini allowed)
    expect(calls).toEqual(["api.groq.com:small", "generativelanguage.googleapis.com:flash", "api.groq.com:big"]);

    __setFetch(async (url, init) => {
      calls.push(`${host(url)}:${JSON.parse(String(init?.body)).model}`);
      return reply("planned");
    });
    calls.length = 0;
    const r = await chat({ ...msg(), purpose: "plan-day" });
    // personal task: gemini is left out
    expect(r.provider).toBe("groq");
    expect(calls).toEqual(["api.groq.com:big"]);
  });

  it("routes tasks through built-in lanes using only allowed providers and models", async () => {
    process.env.GROQ_API_KEY = "g";
    process.env.GROQ_MODELS = "openai/gpt-oss-120b,openai/gpt-oss-20b";
    process.env.GEMINI_API_KEY = "m";
    process.env.GEMINI_MODELS = "gemini-2.5-flash,gemini-2.5-flash-lite";
    const calls: string[] = [];
    __setFetch(async (url, init) => {
      calls.push(`${host(url).split(".")[1]}:${JSON.parse(String(init?.body)).model}`);
      return reply("nope", 503);
    });
    const order = async (purpose?: string) => {
      calls.length = 0;
      __setFetch(async (url, init) => {
        calls.push(`${host(url).split(".")[1]}:${JSON.parse(String(init?.body)).model}`);
        return reply("nope", 503);
      });
      await chat({ ...msg(), purpose }).catch(() => {});
      return [...calls];
    };
    // writing: strongest first; gemini-3.8-flash isn't in GEMINI_MODELS so it's skipped
    expect(await order("resume")).toEqual(["googleapis:gemini-2.5-flash", "googleapis:gemini-2.5-flash-lite", "groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"]);
    // quick: the small fast model first
    expect((await order("job-query"))[0]).toBe("groq:openai/gpt-oss-20b");
    // a provider left out of LLM_PROVIDER_ORDER stays out of lanes
    process.env.LLM_PROVIDER_ORDER = "groq";
    expect(await order("resume")).toEqual(["groq:openai/gpt-oss-120b", "groq:openai/gpt-oss-20b"]);
  });
});
