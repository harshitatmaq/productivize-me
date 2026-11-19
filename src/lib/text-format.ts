/**
 * Markdown formatting for plain textareas: Ctrl/⌘+B wraps the selection in **bold**,
 * lists continue on Enter, and so on. Pure: each function takes the text and the
 * selection and returns one edit (what to replace, and where the selection goes after).
 */

export type TextState = { value: string; start: number; end: number };
export type TextEdit = { from: number; to: number; text: string; selStart: number; selEnd: number };

export type KeyLike = { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean };

const lineStartOf = (value: string, pos: number) => value.lastIndexOf("\n", pos - 1) + 1;
const lineEndOf = (value: string, pos: number) => {
  const i = value.indexOf("\n", pos);
  return i === -1 ? value.length : i;
};

/** Wraps (or unwraps) the selection in a marker: "**", "_", "`", "~~". */
export function toggleWrap(s: TextState, marker: string): TextEdit {
  const { value, start, end } = s;
  const m = marker.length;
  const sel = value.slice(start, end);

  // Already wrapped inside the selection: "**word**" selected.
  if (sel.length >= 2 * m && sel.startsWith(marker) && sel.endsWith(marker)) {
    const inner = sel.slice(m, -m);
    return { from: start, to: end, text: inner, selStart: start, selEnd: start + inner.length };
  }
  // Wrapped just outside the selection: **[word]**.
  if (start >= m && value.slice(start - m, start) === marker && value.slice(end, end + m) === marker) {
    return { from: start - m, to: end + m, text: sel, selStart: start - m, selEnd: end - m };
  }
  // Nothing selected: insert the pair and put the cursor between.
  if (!sel) return { from: start, to: end, text: marker + marker, selStart: start + m, selEnd: start + m };

  // Inline markdown doesn't span lines: wrap each non-empty line. Keep spaces outside the markers.
  const wrapped = sel
    .split("\n")
    .map((line) => {
      const lead = line.match(/^\s*/)![0];
      const trail = line.match(/\s*$/)![0];
      const core = line.slice(lead.length, line.length - trail.length);
      return core ? `${lead}${marker}${core}${marker}${trail}` : line;
    })
    .join("\n");
  if (!sel.includes("\n")) {
    const lead = sel.match(/^\s*/)![0].length;
    const trail = sel.match(/\s*$/)![0].length;
    return { from: start, to: end, text: wrapped, selStart: start + lead + m, selEnd: start + sel.length - trail + m };
  }
  return { from: start, to: end, text: wrapped, selStart: start, selEnd: start + wrapped.length };
}

/** [text](url): selects "url" to type over, or puts the cursor in the label when a URL was selected. */
export function insertLink(s: TextState): TextEdit {
  const { value, start, end } = s;
  const sel = value.slice(start, end).trim();
  if (/^https?:\/\/\S+$/i.test(sel)) {
    const text = `[](${sel})`;
    return { from: start, to: end, text, selStart: start + 1, selEnd: start + 1 };
  }
  const label = sel || "text";
  const text = `[${label}](url)`;
  if (!sel) return { from: start, to: end, text, selStart: start + 1, selEnd: start + 1 + label.length };
  const urlAt = start + label.length + 3;
  return { from: start, to: end, text, selStart: urlAt, selEnd: urlAt + 3 };
}

export type LineKind = "bullet" | "number" | "check" | "quote" | "h1" | "h2" | "h3";

const ANY_PREFIX = /^(\s*)(?:[-*+] \[[ xX]\] |[-*+•] |\d+[.)] |> |#{1,6} )?/;
const HAS: Record<LineKind, RegExp> = {
  bullet: /^\s*[-*+•] (?!\[[ xX]\] )/,
  number: /^\s*\d+[.)] /,
  check: /^\s*[-*+] \[[ xX]\] /,
  quote: /^\s*> /,
  h1: /^# /,
  h2: /^## /,
  h3: /^### /,
};
const PREFIX: Record<LineKind, (i: number) => string> = {
  bullet: () => "- ",
  number: (i) => `${i + 1}. `,
  check: () => "- [ ] ",
  quote: () => "> ",
  h1: () => "# ",
  h2: () => "## ",
  h3: () => "### ",
};

/** Turns the selected lines into a list / checklist / quote / heading, or back to plain lines. */
export function toggleLinePrefix(s: TextState, kind: LineKind): TextEdit {
  const { value, start, end } = s;
  const from = lineStartOf(value, start);
  const lastEnd = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const to = lineEndOf(value, lastEnd);
  const lines = value.slice(from, to).split("\n");
  const filled = lines.filter((l) => l.trim());
  const remove = filled.length > 0 && filled.every((l) => HAS[kind].test(l));
  let n = 0;
  const out = lines.map((line) => {
    if (!line.trim() && lines.length > 1) return line;
    const indent = kind.startsWith("h") ? "" : line.match(/^\s*/)![0];
    const body = line.replace(ANY_PREFIX, "");
    return remove ? `${indent}${body}` : `${indent}${PREFIX[kind](n++)}${body}`;
  });
  const text = out.join("\n");
  if (start === end) {
    // Keep the cursor on the same character of the line.
    const shift = out[0].length - lines[0].length;
    const pos = Math.max(from, start + shift);
    return { from, to, text, selStart: pos, selEnd: pos };
  }
  return { from, to, text, selStart: from, selEnd: from + text.length };
}

const LIST_ITEM = /^(\s*)(?:([-*+]) \[[ xX]\] |([-*+•]) |(\d+)([.)]) |(>) )/;

/** Enter inside a list item: start the next item; Enter on an empty item: end the list. */
export function continueList(s: TextState): TextEdit | null {
  const { value, start, end } = s;
  if (start !== end) return null;
  const from = lineStartOf(value, start);
  const line = value.slice(from, lineEndOf(value, start));
  const m = line.match(LIST_ITEM);
  if (!m || start < from + m[0].length) return null;
  const [prefix, indent, checkBullet, bullet, num, numSep, quote] = m;
  if (!line.slice(prefix.length).trim()) {
    // Empty item: remove its marker instead of adding another.
    const lineEnd = from + line.length;
    return { from, to: lineEnd, text: indent, selStart: from + indent.length, selEnd: from + indent.length };
  }
  const next = checkBullet ? `${checkBullet} [ ] ` : bullet ? `${bullet === "•" ? "-" : bullet} ` : num ? `${Number(num) + 1}${numSep} ` : quote ? "> " : "";
  const text = `\n${indent}${next}`;
  return { from: start, to: end, text, selStart: start + text.length, selEnd: start + text.length };
}

/** Tab / Shift+Tab on list lines indents or outdents them by two spaces. Elsewhere Tab moves focus as usual. */
export function indentList(s: TextState, outdent: boolean): TextEdit | null {
  const { value, start, end } = s;
  const from = lineStartOf(value, start);
  const to = lineEndOf(value, end > start && value[end - 1] === "\n" ? end - 1 : end);
  const lines = value.slice(from, to).split("\n");
  if (!lines.every((l) => !l.trim() || LIST_ITEM.test(l))) return null;
  const out = lines.map((l) => (!l.trim() ? l : outdent ? l.replace(/^ {1,2}/, "") : `  ${l}`));
  const text = out.join("\n");
  if (text === lines.join("\n")) return null;
  if (start === end) {
    const pos = Math.max(from, start + (out[0].length - lines[0].length));
    return { from, to, text, selStart: pos, selEnd: pos };
  }
  return { from, to, text, selStart: from, selEnd: from + text.length };
}

/** The formatting edit for a key press in a markdown textarea, or null to let the key through. */
export function formatForKey(e: KeyLike, s: TextState): TextEdit | null {
  const mod = !!(e.ctrlKey || e.metaKey);
  const key = e.key.toLowerCase();
  if (mod && !e.altKey && !e.shiftKey) {
    if (key === "b") return toggleWrap(s, "**");
    if (key === "i") return toggleWrap(s, "_");
    if (key === "e") return toggleWrap(s, "`");
    if (key === "k") return insertLink(s);
    return null;
  }
  if (mod && e.shiftKey && !e.altKey) {
    if (key === "x") return toggleWrap(s, "~~");
    if (e.code === "Digit8") return toggleLinePrefix(s, "bullet");
    if (e.code === "Digit7") return toggleLinePrefix(s, "number");
    if (e.code === "Digit9") return toggleLinePrefix(s, "check");
    if (e.code === "Period") return toggleLinePrefix(s, "quote");
    return null;
  }
  if (mod && e.altKey && !e.shiftKey) {
    if (e.code === "Digit1") return toggleLinePrefix(s, "h1");
    if (e.code === "Digit2") return toggleLinePrefix(s, "h2");
    if (e.code === "Digit3") return toggleLinePrefix(s, "h3");
    return null;
  }
  if (!mod && !e.altKey) {
    if (e.key === "Enter" && !e.shiftKey) return continueList(s);
    if (e.key === "Tab") return indentList(s, !!e.shiftKey);
  }
  return null;
}

/** Applies an edit to a textarea so the browser's undo (Ctrl+Z) still works and React sees the change. */
export function applyTextEdit(el: HTMLTextAreaElement, edit: TextEdit) {
  el.focus();
  el.setSelectionRange(edit.from, edit.to);
  let ok = false;
  try {
    ok = document.execCommand("insertText", false, edit.text);
  } catch {
    ok = false;
  }
  if (!ok || el.value.slice(edit.from, edit.from + edit.text.length) !== edit.text) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(el, el.value.slice(0, edit.from) + edit.text + el.value.slice(edit.to));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  el.setSelectionRange(edit.selStart, edit.selEnd);
  // React may re-render the controlled value after this event; keep the selection,
  // unless you've already typed or moved the cursor since.
  const expected = el.value;
  requestAnimationFrame(() => {
    if (document.activeElement !== el || el.value !== expected) return;
    if (el.selectionStart !== edit.selStart || el.selectionEnd !== edit.selEnd) {
      if (el.selectionStart === el.value.length && el.selectionEnd === el.value.length) el.setSelectionRange(edit.selStart, edit.selEnd);
    }
  });
}
