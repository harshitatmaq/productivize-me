"use client";

import type { ReactNode } from "react";

/**
 * Renders plain text with rich formatting.
 *
 * Patterns recognised:
 *   1. / 2. / 3.       → numbered list with indentation
 *   - / * / •           → bullet list with indentation
 *   **bold**            → bold
 *   *italic*            → italic
 *   __underline__       → underline
 *   ~~strikethrough~~   → strikethrough
 *   `code`              → inline code
 *   > blockquote        → indented blockquote
 *   # Heading           → heading styles
 *   --- / ***           → horizontal rule
 */

interface Props {
  text: string;
  className?: string;
}

export default function FormattedText({ text, className = "" }: Props) {
  const lines = text.split("\n");
  const elements: ReactNode[] = [];
  let listBuffer: { type: "ol" | "ul"; items: ReactNode[] } | null = null;
  let blockquoteBuffer: string[] | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    if (listBuffer.type === "ol") {
      elements.push(
        <ol key={`ol-${elements.length}`} className="fmt-ol">
          {listBuffer.items.map((item, i) => (
            <li key={i} className="fmt-li">
              {item}
            </li>
          ))}
        </ol>,
      );
    } else {
      elements.push(
        <ul key={`ul-${elements.length}`} className="fmt-ul">
          {listBuffer.items.map((item, i) => (
            <li key={i} className="fmt-li">
              {item}
            </li>
          ))}
        </ul>,
      );
    }
    listBuffer = null;
  };

  const flushBlockquote = () => {
    if (!blockquoteBuffer || blockquoteBuffer.length === 0) return;
    elements.push(
      <blockquote key={`bq-${elements.length}`} className="fmt-blockquote">
        {blockquoteBuffer.map((line, i) => (
          <span key={i}>
            {renderInline(line)}
            {i < blockquoteBuffer!.length - 1 && <br />}
          </span>
        ))}
      </blockquote>,
    );
    blockquoteBuffer = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushList();
      flushBlockquote();
      elements.push(<hr key={`hr-${i}`} className="fmt-hr" />);
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      flushList();
      flushBlockquote();
      const level = headingMatch[1].length;
      const content = headingMatch[2];

      if (level === 1) {
        elements.push(
          <h3 key={`h-${i}`} className="fmt-h1">
            {renderInline(content)}
          </h3>,
        );
      } else if (level === 2) {
        elements.push(
          <h4 key={`h-${i}`} className="fmt-h2">
            {renderInline(content)}
          </h4>,
        );
      } else {
        elements.push(
          <h5 key={`h-${i}`} className="fmt-h3">
            {renderInline(content)}
          </h5>,
        );
      }

      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      flushList();
      if (!blockquoteBuffer) blockquoteBuffer = [];
      blockquoteBuffer.push(trimmed.slice(2));
      continue;
    } else {
      flushBlockquote();
    }

    // Numbered list: "1. ", "2. ", "1) ", etc.
    const olMatch = trimmed.match(/^(\d+)[.)]\s+(.+)/);
    if (olMatch) {
      if (listBuffer && listBuffer.type !== "ol") flushList();
      if (!listBuffer) listBuffer = { type: "ol", items: [] };
      listBuffer.items.push(renderInline(olMatch[2]));
      continue;
    }

    // Bullet list: "- ", "* ", "• "
    const ulMatch = trimmed.match(/^[-*•]\s+(.+)/);
    if (ulMatch) {
      if (listBuffer && listBuffer.type !== "ul") flushList();
      if (!listBuffer) listBuffer = { type: "ul", items: [] };
      listBuffer.items.push(renderInline(ulMatch[1]));
      continue;
    }

    // Regular line — flush any pending list
    flushList();

    if (trimmed === "") {
      elements.push(<div key={`br-${i}`} className="h-2" />);
    } else {
      elements.push(
        <p key={`p-${i}`} className="fmt-p">
          {renderInline(trimmed)}
        </p>,
      );
    }
  }

  flushList();
  flushBlockquote();

  return <div className={`fmt-root ${className}`}>{elements}</div>;
}

/**
 * Inline formatting: bold, italic, underline, strikethrough, inline code.
 */
function renderInline(text: string): ReactNode {
  // Process inline patterns with a single regex pass
  const parts: ReactNode[] = [];
  // Pattern matches: **bold**, *italic*, __underline__, ~~strike~~, `code`
  const regex =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(__(.+?)__)|(\~\~(.+?)\~\~)|(`(.+?)`)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add text before match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // **bold**
      parts.push(
        <strong key={`b-${match.index}`} className="fmt-bold">
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      // *italic*
      parts.push(
        <em key={`i-${match.index}`} className="fmt-italic">
          {match[4]}
        </em>,
      );
    } else if (match[5]) {
      // __underline__
      parts.push(
        <u key={`u-${match.index}`} className="fmt-underline">
          {match[6]}
        </u>,
      );
    } else if (match[7]) {
      // ~~strikethrough~~
      parts.push(
        <s key={`s-${match.index}`} className="fmt-strike">
          {match[8]}
        </s>,
      );
    } else if (match[9]) {
      // `code`
      parts.push(
        <code key={`c-${match.index}`} className="fmt-code">
          {match[10]}
        </code>,
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 0 ? text : <>{parts}</>;
}
