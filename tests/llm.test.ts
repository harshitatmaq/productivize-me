import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractJson } from "@/lib/ai/json";
import { __setFetch, chat, chatJson, LlmChainError } from "@/lib/ai/llm";

const ENV_KEYS = ["GROQ_API_KEY", "CEREBRAS_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "MISTRAL_API_KEY", "MAQ_AI_API_KEY", "MAQ_AI_BASE_URL", "MAQ_AI_MODELS", "LLM_PROVIDER_ORDER", "GROQ_MODELS"];
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
