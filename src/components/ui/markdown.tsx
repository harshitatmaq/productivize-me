import { Fragment, type ReactNode } from "react";

/** Tiny, safe markdown subset (bold, italics, strikethrough, code, links, lists, checklists, quotes, headings). No HTML injection. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={key}>{inline(tok.slice(2, -2), key)}</strong>);
    else if (tok.startsWith("~~")) out.push(<del key={key}>{inline(tok.slice(2, -2), key)}</del>);
    else if (tok.startsWith("`")) out.push(<code key={key}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("[")) {
      const label = tok.slice(1, tok.indexOf("]"));
      out.push(
        <a key={key} href={m[2]} target="_blank" rel="noreferrer">
          {label}
        </a>,
      );
    } else out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  let quote: string[] = [];
  let code: string[] | null = null;
  const flushPara = () => {
    if (para.length) {
      const k = `p${blocks.length}`;
      blocks.push(
        <p key={k}>
          {para.map((l, i) => (
            <Fragment key={i}>
              {i > 0 ? <br /> : null}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </p>,
      );
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      const k = `l${blocks.length}`;
      const items = list.items.map((it, i) => {
        const task = it.match(/^\[([ xX])\]\s+(.*)$/);
        if (!task) return <li key={i}>{inline(it, `${k}-${i}`)}</li>;
        const done = task[1] !== " ";
        return (
          <li key={i} className="task-item">
            <span aria-hidden className={done ? "task-box done" : "task-box"}>
              {done ? "✓" : ""}
            </span>
            <span className={done ? "task-done" : undefined}>{inline(task[2], `${k}-${i}`)}</span>
            <span className="sr-only">{done ? " (done)" : " (to do)"}</span>
          </li>
        );
      });
      const hasTasks = list.items.some((it) => /^\[[ xX]\]\s/.test(it));
      blocks.push(list.ordered ? <ol key={k}>{items}</ol> : <ul key={k} className={hasTasks ? "task-list" : undefined}>{items}</ul>);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      const k = `q${blocks.length}`;
      blocks.push(
        <blockquote key={k}>
          {quote.map((l, i) => (
            <Fragment key={i}>
              {i > 0 ? <br /> : null}
              {inline(l, `${k}-${i}`)}
            </Fragment>
          ))}
        </blockquote>,
      );
      quote = [];
    }
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (code) {
      if (/^\s*```/.test(line)) {
        blocks.push(
          <pre key={`c${blocks.length}`}>
            <code>{code.join("\n")}</code>
          </pre>,
        );
        code = null;
      } else code.push(raw);
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushAll();
      code = [];
      continue;
    }
    const ul = line.match(/^\s*[-*+•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const q = line.match(/^\s*>\s?(.*)$/);
    if (ul || ol) {
      flushPara();
      flushQuote();
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
    } else if (h) {
      flushAll();
      const k = `h${blocks.length}`;
      const content = inline(h[2], k);
      blocks.push(h[1].length === 1 ? <h3 key={k}>{content}</h3> : h[1].length === 2 ? <h4 key={k}>{content}</h4> : <h5 key={k}>{content}</h5>);
    } else if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
    } else if (!line.trim()) {
      flushAll();
    } else {
      flushList();
      flushQuote();
      para.push(line);
    }
  }
  if (code) blocks.push(<pre key={`c${blocks.length}`}><code>{(code as string[]).join("\n")}</code></pre>);
  flushAll();
  return <div className={`prose-lite ${className ?? ""}`}>{blocks}</div>;
}
