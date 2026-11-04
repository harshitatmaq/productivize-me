import { cn } from "@/lib/utils";

/** Half-filled circle mark: a day in progress. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("h-5 w-5", className)} aria-hidden>
      <defs>
        <linearGradient id="pm-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b93f5" />
          <stop offset="1" stopColor="#5e6ad2" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="13" fill="none" stroke="url(#pm-g)" strokeWidth="3" />
      <path d="M16 3 A13 13 0 0 1 16 29 Z" fill="url(#pm-g)" />
    </svg>
  );
}
