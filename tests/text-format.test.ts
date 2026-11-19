import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/ui/markdown";
import { continueList, formatForKey, indentList, insertLink, toggleLinePrefix, toggleWrap, type TextEdit, type TextState } from "@/lib/text-format";

/** Applies an edit to plain text and returns the text with the selection marked as [ ]. */
function run(s: TextState, edit: TextEdit | null): string {
  if (!edit) return "(no edit)";
  const value = s.value.slice(0, edit.from) + edit.text + s.value.slice(edit.to);
  return `${value.slice(0, edit.selStart)}[${value.slice(edit.selStart, edit.selEnd)}]${value.slice(edit.selEnd)}`;
}
/** "hello [world]" → state with "world" selected; "a|b" → cursor. */
function state(marked: string): TextState {
  if (marked.includes("|")) {
    const start = marked.indexOf("|");
    return { value: marked.replace("|", ""), start, end: start };
  }
  const start = marked.indexOf("[");
  const end = marked.indexOf("]") - 1;
  return { value: marked.replace("[", "").replace("]", ""), start, end };
}
const key = (k: string, extra: Partial<{ code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key: k, ctrlKey: true, ...extra });

describe("bold / italic / code / strikethrough", () => {
  it("wraps the selection and keeps it selected", () => {
    const s = state("spark [partitioning] matters");
    expect(run(s, toggleWrap(s, "**"))).toBe("spark **[partitioning]** matters");
  });

  it("unwraps when pressed again (selection inside or including the markers)", () => {
    const inside = state("spark **[partitioning]** matters");
    expect(run(inside, toggleWrap(inside, "**"))).toBe("spark [partitioning] matters");
    const incl = state("spark [**partitioning**] matters");
    expect(run(incl, toggleWrap(incl, "**"))).toBe("spark [partitioning] matters");
  });

  it("keeps surrounding spaces outside the markers (double-click selects a trailing space)", () => {
    const s = state("use [cache ]here");
    expect(run(s, toggleWrap(s, "_"))).toBe("use _[cache]_ here");
  });

  it("with nothing selected, inserts the pair with the cursor in between", () => {
    const s = state("note: |");
    expect(run(s, toggleWrap(s, "`"))).toBe("note: `[]`");
  });

  it("wraps each line of a multi-line selection", () => {
    const s = state("[one\n\ntwo]");
    expect(run(s, toggleWrap(s, "**"))).toBe("[**one**\n\n**two**]");
  });

  it("maps the keys: Ctrl/⌘+B, I, E, Shift+X", () => {
    const s = state("[x]");
    expect(run(s, formatForKey(key("b"), s))).toBe("**[x]**");
    expect(run(s, formatForKey({ key: "b", metaKey: true }, s))).toBe("**[x]**");
    expect(run(s, formatForKey(key("i"), s))).toBe("_[x]_");
    expect(run(s, formatForKey(key("e"), s))).toBe("`[x]`");
    expect(run(s, formatForKey(key("X", { shiftKey: true }), s))).toBe("~~[x]~~");
    expect(formatForKey({ key: "b" }, s)).toBeNull(); // plain "b" types normally
    expect(formatForKey(key("z"), s)).toBeNull(); // undo stays native
  });
});

describe("links", () => {
  it("wraps selected text and selects 'url' to type over", () => {
    const s = state("read [the docs] first");
    expect(run(s, insertLink(s))).toBe("read [the docs]([url]) first");
  });
  it("puts a selected URL in the link and the cursor in the label", () => {
    const s = state("[https://spark.apache.org]");
    expect(run(s, formatForKey(key("k"), s))).toBe("[[]](https://spark.apache.org)");
  });
  it("with nothing selected, selects the label placeholder", () => {
    const s = state("|");
    expect(run(s, insertLink(s))).toBe("[[text]](url)");
  });
});

describe("lists, quotes and headings", () => {
  it("turns selected lines into a bulleted list and back", () => {
    const s = state("[cache results\nrun daily]");
    const once = run(s, formatForKey(key("*", { shiftKey: true, code: "Digit8" }), s));
    expect(once).toBe("[- cache results\n- run daily]");
    const back = state(once);
    expect(run(back, toggleLinePrefix(back, "bullet"))).toBe("[cache results\nrun daily]");
  });

  it("numbers lines, and switches list types", () => {
    const s = state("[- a\n- b\n- c]");
    expect(run(s, toggleLinePrefix(s, "number"))).toBe("[1. a\n2. b\n3. c]");
    expect(run(s, formatForKey(key("(", { shiftKey: true, code: "Digit9" }), s))).toBe("[- [ ] a\n- [ ] b\n- [ ] c]");
  });

  it("works on the cursor's line and keeps the cursor on the same character", () => {
    const s = state("intro\nfil|ter early\nend");
    expect(run(s, toggleLinePrefix(s, "quote"))).toBe("intro\n> fil[]ter early\nend");
    expect(run(s, formatForKey(key("1", { altKey: true, code: "Digit2" }), s))).toBe("intro\n## fil[]ter early\nend");
  });
});

describe("Enter and Tab in lists", () => {
  it("continues bullets, numbers and checklists", () => {
    expect(run(state("- one|"), continueList(state("- one|")))).toBe("- one\n- []");
    expect(run(state("2. two|"), continueList(state("2. two|")))).toBe("2. two\n3. []");
    expect(run(state("  - [x] done|"), continueList(state("  - [x] done|")))).toBe("  - [x] done\n  - [ ] []");
    expect(run(state("> quoted|"), continueList(state("> quoted|")))).toBe("> quoted\n> []");
  });

  it("ends the list on an empty item", () => {
    const s = state("- one\n- |");
    expect(run(s, continueList(s))).toBe("- one\n[]");
  });

  it("does nothing outside lists or with Shift+Enter", () => {
    const s = state("plain text|");
    expect(continueList(s)).toBeNull();
    expect(formatForKey({ key: "Enter", shiftKey: true }, state("- one|"))).toBeNull();
  });

  it("indents list lines with Tab, and lets Tab move focus elsewhere", () => {
    const s = state("- a\n- b|");
    expect(run(s, indentList(s, false))).toBe("- a\n  - b[]");
    const ind = state("  - b|");
    expect(run(ind, formatForKey({ key: "Tab", shiftKey: true }, ind))).toBe("- b[]");
    expect(formatForKey({ key: "Tab" }, state("plain|"))).toBeNull();
  });

  it("undoes in one step in the browser (formatting uses the native text insertion)", () => {
    // Covered by applyTextEdit in the browser; here we only check edits are minimal and local.
    const e = toggleWrap(state("aaa [b] ccc"), "**");
    expect(e.from).toBe(4);
    expect(e.to).toBe(5);
  });
});

describe("markdown display", () => {
  const html = (md: string) => renderToStaticMarkup(createElement(Markdown, { text: md }));

  it("renders the formats the shortcuts write", () => {
    const out = html("# Spark costs\n\n**Bold _and italic_** and ~~old~~ and `code`\n\n> a quote\n\n- [x] cache\n- [ ] partition\n\n```\ndf.cache()\n```");
    expect(out).toContain("<h3>Spark costs</h3>");
    expect(out).toContain("<strong>Bold <em>and italic</em></strong>");
    expect(out).toContain("<del>old</del>");
    expect(out).toContain("<blockquote>a quote</blockquote>");
    expect(out).toContain('class="task-list"');
    expect(out).toContain("task-box done");
    expect(out).toContain("<pre><code>df.cache()</code></pre>");
  });

  it("never renders HTML from the text", () => {
    expect(html("<img src=x onerror=alert(1)> **hi**")).toContain("&lt;img");
  });
});
