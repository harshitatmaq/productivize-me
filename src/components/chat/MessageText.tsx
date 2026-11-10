"use client";

import { useEffect, useState } from "react";
import { hostLabel, segmentText } from "@/lib/chat/links";
import { segmentMentions } from "@/lib/chat/mentions";
import type { UserId } from "@/lib/chat/types";

interface Preview {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  site_name: string | null;
  failed?: boolean;
}

/** Message body with URLs turned into links and `@name` into a chip. */
export function MessageText({
  body,
  names,
}: {
  body: string;
  names: Record<UserId, string>;
}) {
  const segments = segmentText(body);

  return (
    <>
      {segments.map((segment, i) =>
        segment.type === "link" ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            // noopener is the one that matters: without it the opened page gets
            // a handle back to this window via `window.opener`.
            rel="noopener noreferrer nofollow"
            onClick={(e) => e.stopPropagation()}
            className="underline decoration-1 underline-offset-2 opacity-90 hover:opacity-100"
          >
            {segment.value}
          </a>
        ) : (
          // Mentions are looked for only in the non-link runs, so an `@` inside
          // a URL is never mistaken for one.
          <Mentioned key={i} text={segment.value} names={names} />
        ),
      )}
    </>
  );
}

function Mentioned({
  text,
  names,
}: {
  text: string;
  names: Record<UserId, string>;
}) {
  const parts = segmentMentions(text, names);

  return (
    <>
      {parts.map((part, i) =>
        part.type === "mention" ? (
          <span
            key={i}
            className="rounded-[5px] bg-on-bubble-strong px-1 py-px font-sans text-[0.875rem] font-medium"
          >
            {part.value}
          </span>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  );
}

/**
 * Open Graph card for the first link in a message.
 *
 * Renders nothing at all unless the server returned a usable title — a card
 * that is only a bare hostname is worse than no card, since it costs a chunk of
 * vertical space and tells you nothing the link text did not.
 */
export function LinkPreview({ url, mine }: { url: string; mine: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/chat/preview?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data || data.failed || !data.title) return;
        setPreview(data);
      })
      .catch(() => {
        // Offline or blocked; the plain link is still there and still works.
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!preview) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      onClick={(e) => e.stopPropagation()}
      className={`animate-fade-in mt-2 block overflow-hidden rounded-xl border transition-opacity hover:opacity-95 ${
        mine ? "border-on-bubble-line bg-on-bubble" : "border-hairline bg-bg"
      }`}
    >
      {preview.image_url && (
        <img
          src={preview.image_url}
          alt=""
          loading="lazy"
          className="h-28 w-full object-cover"
          onError={(e) => {
            // A broken thumbnail should collapse, not leave a torn-image box.
            e.currentTarget.style.display = "none";
          }}
        />
      )}

      <div className="px-3 py-2">
        <p className="text-[0.625rem] tracking-wide uppercase opacity-70">
          {preview.site_name || hostLabel(url)}
        </p>
        <p className="mt-0.5 line-clamp-2 text-[0.8125rem] leading-snug font-medium">
          {preview.title}
        </p>
        {preview.description && (
          <p className="mt-0.5 line-clamp-2 text-[0.75rem] leading-snug opacity-75">
            {preview.description}
          </p>
        )}
      </div>
    </a>
  );
}
