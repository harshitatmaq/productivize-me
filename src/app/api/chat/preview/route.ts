import { lookup } from "node:dns/promises";
import { NextResponse } from "next/server";
import { HttpError, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";


/**
 * Open Graph metadata for a shared link.
 *
 * The outbound fetch happens here rather than in the browser because the page
 * is on another origin and CORS would block it — but that also means this route
 * is a request-forger by design, so it is fenced in carefully:
 *
 *   - it requires a valid session, so it is not an open proxy;
 *   - only http/https;
 *   - the hostname is resolved and rejected if it points anywhere private,
 *     which is what stops it being used to read cloud metadata endpoints or
 *     probe the internal network;
 *   - the response is capped in both time and size;
 *   - redirects are not followed, so a public URL cannot bounce to a private one.
 */

const FETCH_TIMEOUT_MS = 6000;
const MAX_BYTES = 512 * 1024;
/** Re-fetch metadata older than this; sites change their titles. */
const CACHE_TTL_DAYS = 30;

function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    // Loopback, link-local, unique-local.
    return (
      v6 === "::1" ||
      v6 === "::" ||
      v6.startsWith("fe80:") ||
      v6.startsWith("fc") ||
      v6.startsWith("fd") ||
      // IPv4-mapped: strip and re-check as v4.
      (v6.startsWith("::ffff:") && isPrivateAddress(v6.slice(7)))
    );
  }

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  );
}

async function isSafeUrl(raw: string): Promise<URL | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  try {
    // Every resolved address must be public — a hostname can legitimately
    // return several, and one private answer is enough to make it unsafe.
    const addresses = await lookup(url.hostname, { all: true });
    if (addresses.length === 0) return null;
    if (addresses.some((entry) => isPrivateAddress(entry.address))) return null;
  } catch {
    return null;
  }

  return url;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function metaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    // Attribute order varies, so match either arrangement.
    const patterns = [
      new RegExp(
        `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)["']`,
        "i"
      ),
      new RegExp(
        `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`,
        "i"
      ),
    ];
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]?.trim()) return decodeEntities(match[1].trim());
    }
  }
  return null;
}

async function fetchMetadata(url: URL) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      // A redirect could land somewhere private that the DNS check never saw.
      redirect: "manual",
      headers: {
        // Identifying honestly, and asking only for HTML.
        "User-Agent": "Productivize link preview",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return null;
    if (!response.headers.get("content-type")?.includes("html")) return null;

    // Read only the head-ish portion; metadata lives near the top.
    const reader = response.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
    }
    await reader.cancel().catch(() => {});

    const html = new TextDecoder().decode(
      chunks.reduce((acc, chunk) => {
        const merged = new Uint8Array(acc.length + chunk.length);
        merged.set(acc);
        merged.set(chunk, acc.length);
        return merged;
      }, new Uint8Array())
    );

    const title =
      metaContent(html, ["og:title", "twitter:title"]) ??
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ??
      null;

    const image = metaContent(html, ["og:image", "twitter:image"]);

    return {
      title: title ? decodeEntities(title).slice(0, 200) : null,
      description:
        metaContent(html, ["og:description", "twitter:description", "description"])?.slice(0, 300) ??
        null,
      // Resolve relative image paths against the page itself.
      image_url: image ? new URL(image, url).toString().slice(0, 1000) : null,
      site_name: metaContent(html, ["og:site_name"])?.slice(0, 100) ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  try {
    await requireUser();
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 401;
    return NextResponse.json({ error: "Not signed in." }, { status });
  }

  const target = new URL(request.url).searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "Missing url." }, { status: 400 });
  }

  const supabase = supabaseAdmin();

  const { data: cached } = await supabase
    .from("link_previews")
    .select("*")
    .eq("url", target)
    .maybeSingle();

  const fresh =
    cached &&
    Date.now() - new Date(cached.fetched_at).getTime() <
      CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;

  if (fresh) {
    return NextResponse.json(cached.failed ? { failed: true } : cached);
  }

  const safe = await isSafeUrl(target);
  if (!safe) {
    // Recorded as failed so a hostile or unreachable link is not retried on
    // every single render.
    await supabase
      .from("link_previews")
      .upsert(
        { url: target, failed: true, fetched_at: new Date().toISOString() },
        { onConflict: "url" }
      );
    return NextResponse.json({ failed: true });
  }

  const meta = await fetchMetadata(safe);

  const row = {
    url: target,
    title: meta?.title ?? null,
    description: meta?.description ?? null,
    image_url: meta?.image_url ?? null,
    site_name: meta?.site_name ?? null,
    // Nothing worth showing is the same as a failure, as far as the UI cares.
    failed: !meta?.title,
    fetched_at: new Date().toISOString(),
  };

  await supabase.from("link_previews").upsert(row, { onConflict: "url" });

  return NextResponse.json(row.failed ? { failed: true } : row);
}
