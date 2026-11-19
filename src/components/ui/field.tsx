"use client";

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useIsMac } from "@/lib/shortcuts";
import { applyTextEdit, formatForKey } from "@/lib/text-format";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn("field", className)} {...props} />;
});

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Markdown shortcuts: Ctrl/⌘+B bold, Ctrl+I italic, Ctrl+K link, lists continue on Enter… (see Ctrl+/). */
  markdown?: boolean;
  /** Show the one-line shortcut hint under a markdown field (default true). */
  hint?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, markdown, hint = true, onKeyDown, ...props },
  ref,
) {
  const mac = useIsMac();
  const field = (
    <textarea
      ref={ref}
      className={cn("field min-h-20 resize-y leading-relaxed", className)}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (!markdown || e.defaultPrevented || e.nativeEvent.isComposing) return;
        const el = e.currentTarget;
        const edit = formatForKey(e, { value: el.value, start: el.selectionStart, end: el.selectionEnd });
        if (!edit) return;
        e.preventDefault();
        e.stopPropagation();
        applyTextEdit(el, edit);
      }}
      {...props}
    />
  );
  if (!markdown || !hint) return field;
  const k = (x: string) => (mac ? `⌘${x}` : `Ctrl+${x}`);
  return (
    <div>
      {field}
      <p className="mt-1 text-[11px] text-faint">
        Markdown · {k("B")} bold · {k("I")} italic · {k("K")} link · {mac ? "⌘⇧8" : "Ctrl+Shift+8"} list · {k("/")} outside a note for all shortcuts
      </p>
    </div>
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <select ref={ref} className={cn("field appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8f98' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...props}
    >
      {children}
    </select>
  );
});

export function Field({ label, hint, children, className }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      {label ? <span className="label">{label}</span> : null}
      {children}
      {hint ? <span className="mt-1.5 block text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  description,
  ariaLabel,
}: {
  checked: boolean;
  /** Spoken name when the switch has no visible label next to it. */
  ariaLabel?: string;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: ReactNode;
  description?: ReactNode;
}) {
  const id = useId();
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? `${id}-label` : undefined}
      aria-label={!label ? ariaLabel : undefined}
      aria-describedby={description ? `${id}-desc` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full border transition-colors duration-200 disabled:opacity-50",
        checked ? "border-accent bg-accent" : "border-line-strong bg-panel-2",
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-[15px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );
  if (!label) return control;
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div id={`${id}-label`} className="text-[13.5px] text-fg">
          {label}
        </div>
        {description ? (
          <div id={`${id}-desc`} className="mt-0.5 text-xs text-muted">
            {description}
          </div>
        ) : null}
      </div>
      <div className="pt-0.5">{control}</div>
    </div>
  );
}
