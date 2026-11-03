/** Pull a JSON value out of an LLM reply, tolerating code fences, prose and <think> blocks. */
export function extractJson<T = unknown>(raw: string): T {
  let text = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    // fall through to bracket matching
  }

  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  const starts = [firstObj, firstArr].filter((i) => i >= 0);
  if (starts.length === 0) throw new Error("No JSON found in model output");
  const start = Math.min(...starts);
  const open = text[start];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const candidate = text.slice(start, i + 1);
        return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1")) as T;
      }
    }
  }
  throw new Error("Unbalanced JSON in model output");
}
