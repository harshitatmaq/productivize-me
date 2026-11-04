import "server-only";

import { readPage } from "@/lib/search/web";
import { stripHtml } from "./normalize";

/**
 * Fetches the full job description for a posting. Workday boards expose a JSON
 * detail endpoint; everything else goes through Jina Reader (free).
 */
export async function fetchFullDescription(url: string, maxChars = 8000): Promise<string | null> {
  try {
    const wd = url.match(/^https:\/\/([a-z0-9-]+\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)(\/job\/.+)$/i);
    if (wd) {
      const [, host, site, path] = wd;
      const tenant = host.split(".")[0];
      const res = await fetch(`https://${host}/wday/cxs/${tenant}/${site}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (res.ok) {
        const d = (await res.json()) as { jobPostingInfo?: { jobDescription?: string } };
        const text = stripHtml(d.jobPostingInfo?.jobDescription, maxChars);
        if (text) return text;
      }
    }
    if (url.startsWith("https://news.ycombinator.com/")) return null; // HN text is already complete
    const page = await readPage(url, maxChars + 2000);
    if (!page) return null;
    // Drop Jina's header lines and obvious navigation noise.
    return page
      .replace(/^(Title|URL Source|Published Time|Markdown Content):.*$/gim, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, maxChars);
  } catch {
    return null;
  }
}

/** Pulls the page title Jina Reader reports, if any. */
export function pageTitle(raw: string | null): string | null {
  return raw?.match(/^Title:\s*(.+)$/m)?.[1]?.trim() ?? null;
}
