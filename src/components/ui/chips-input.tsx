"use client";

import { Tip } from "./menu";
import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

/** Comma/Enter separated tag input. */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  className,
  prefix,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  className?: string;
  prefix?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map((s) => s.trim().replace(/^#/, ""))
      .filter(Boolean);
    if (!parts.length) return;
    const seen = new Set(value.map((v) => v.toLowerCase()));
    onChange([...value, ...parts.filter((p) => !seen.has(p.toLowerCase()))]);
    setDraft("");
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      onChange(value.slice(0, -1));
    }
  };
  return (
    <div className={cn("field flex min-h-9 flex-wrap items-center gap-1.5 py-1.5", className)}>
      {value.map((v) => (
        <span key={v} className="inline-flex h-6 items-center gap-1 rounded-md border border-line bg-panel px-1.5 text-[12px] text-fg-2">
          {prefix}
          {v}
          <Tip content={`Remove ${v}`}>
            <button type="button" className="text-faint hover:text-fg" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              <X className="h-3 w-3" />
            </button>
          </Tip>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => add(draft)}
        placeholder={value.length ? "" : placeholder}
        className="min-w-24 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
      />
    </div>
  );
}
