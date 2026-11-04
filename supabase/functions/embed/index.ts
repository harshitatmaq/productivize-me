// Supabase Edge Function: free text embeddings with the built-in gte-small model (384 dims).
// Deploy:  supabase functions deploy embed --no-verify-jwt
// Secret:  supabase secrets set EMBED_SECRET=<same value as the app's CRON_SECRET>
// Then set EMBED_FUNCTION_ENABLED=true in the app's environment.

// deno-lint-ignore no-explicit-any
const session = new (globalThis as any).Supabase.ai.Session("gte-small");

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (req.headers.get("x-embed-secret") !== Deno.env.get("EMBED_SECRET")) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { input } = (await req.json()) as { input?: string[] };
  if (!Array.isArray(input) || input.length === 0) return Response.json({ embeddings: [] });
  const embeddings: number[][] = [];
  for (const text of input.slice(0, 64)) {
    embeddings.push(await session.run(String(text).slice(0, 4000), { mean_pool: true, normalize: true }));
  }
  return Response.json({ embeddings });
});
