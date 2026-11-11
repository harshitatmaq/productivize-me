/**
 * npm run ai:check — which AI models can your keys actually use?
 *
 * For every provider with a key it lists the models the provider offers, checks
 * each model you configured, makes one tiny test call per model, and prints the
 * environment lines to use (only models that answered). Keys are never printed.
 *
 *   npm run ai:check            # check everything
 *   npm run ai:check -- groq    # one provider
 */
import { DEFAULT_PROVIDER_ORDER, isConfigured, providerDefs, type ProviderDef } from "../src/lib/ai/providers";

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const t = Date.now();
  const v = await fn();
  return [v, Date.now() - t];
}

function headers(p: ProviderDef) {
  return { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json", ...(p.headers ?? {}) };
}

async function listModels(p: ProviderDef): Promise<string[] | null> {
  try {
    const res = await fetch(`${p.baseUrl}/models`, { headers: headers(p), signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { id?: string; name?: string }[]; result?: { id?: string; name?: string }[] };
    const rows = body.data ?? body.result ?? [];
    return rows.map((m) => String(m.id ?? m.name ?? "").replace(/^models\//, "")).filter(Boolean);
  } catch {
    return null;
  }
}

async function tryModel(p: ProviderDef, model: string): Promise<{ ok: boolean; ms: number; note: string }> {
  try {
    const [res, ms] = await timed(() =>
      fetch(`${p.baseUrl}/chat/completions`, {
        method: "POST",
        headers: headers(p),
        body: JSON.stringify({ model, messages: [{ role: "user", content: 'Reply with exactly: {"ok":true}' }], max_tokens: 200, temperature: 0 }),
        signal: AbortSignal.timeout(Math.min(p.timeoutMs, 60_000)),
      }),
    );
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
        msg = (typeof j.error === "string" ? j.error : j.error?.message) ?? j.message ?? text;
      } catch {}
      const kind = res.status === 429 ? "rate limited (try again later)" : res.status === 404 ? "not available" : res.status === 401 || res.status === 403 ? "key rejected" : `HTTP ${res.status}`;
      return { ok: false, ms, note: `${kind}: ${msg.replace(/\s+/g, " ").slice(0, 140)}` };
    }
    const j = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
    const reply = j.choices?.[0]?.message?.content?.trim() ?? "";
    return { ok: true, ms, note: reply ? `replied “${reply.slice(0, 40)}”` : "empty reply (may need more output tokens)" };
  } catch (e) {
    return { ok: false, ms: 0, note: (e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message.slice(0, 140) };
  }
}

async function main() {
  const defs = providerDefs();
  const order = [...DEFAULT_PROVIDER_ORDER, ...Object.keys(defs).filter((id) => !DEFAULT_PROVIDER_ORDER.includes(id))];
  const working: Record<string, string[]> = {};
  console.log("Checking AI providers (keys are never printed)…\n");

  for (const id of order) {
    const p = defs[id];
    if (!p || (only.length && !only.includes(id))) continue;
    if (!p.apiKey || !p.baseUrl) {
      console.log(`${dim("○")} ${p.label}: no key${id === "cloudflare" && p.apiKey ? " (set CLOUDFLARE_ACCOUNT_ID)" : ""}${p.signupUrl ? dim(` — get one at ${p.signupUrl}`) : ""}`);
      continue;
    }
    console.log(`● ${p.label}`);
    const available = await listModels(p);
    if (available) {
      const sample = id === "openrouter" ? available.filter((m) => m.endsWith(":free")) : available;
      console.log(dim(`  offers ${available.length} models${id === "openrouter" ? ` (${sample.length} free)` : ""}${sample.length ? `, e.g. ${sample.slice(0, 12).join(", ")}${sample.length > 12 ? ", …" : ""}` : ""}`));
    } else console.log(dim("  (couldn't list models; testing the configured ones directly)"));

    if (!isConfigured(p)) {
      console.log(red(`  no models configured — set ${p.modelsEnv}`));
      continue;
    }
    working[id] = [];
    for (const model of p.models) {
      const listed = available ? available.includes(model) : null;
      const r = await tryModel(p, model);
      if (r.ok) working[id].push(model);
      console.log(`  ${r.ok ? green("✓") : red("✗")} ${model}${listed === false ? red(" (not in the provider's list)") : ""} ${dim(r.ok ? `${r.ms} ms · ${r.note}` : r.note)}`);
    }
    console.log("");
  }

  const ids = order.filter((id) => working[id]?.length);
  console.log("Suggested settings for .env.local (and Vercel → Environment Variables):\n");
  console.log(`LLM_PROVIDER_ORDER=${ids.join(",") || "(none working)"}`);
  for (const id of ids) console.log(`${defs[id].modelsEnv}=${working[id].join(",")}`);
  const broken = order.filter((id) => working[id] && working[id].length < defs[id].models.length);
  if (broken.length) console.log(dim("\nModels marked ✗ are skipped automatically, but removing them saves a wasted call."));
  if (!ids.length) process.exitCode = 1;
}

main();
