"use client";

import { ExternalLink, MessageCircle, Sparkle } from "lucide-react";
import type { LearningEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

export type PromptKind = "deeper" | "quiz" | "flashcards" | "next" | "project";

export const PROMPTS: { id: PromptKind; label: string; build: (e: Pick<LearningEntry, "title" | "content" | "questions" | "tags">) => string }[] = [
  {
    id: "deeper",
    label: "Explain deeper",
    build: (e) =>
      `I'm learning about "${e.title}". Here are my notes:\n\n${e.content ?? ""}\n\n${e.questions ? `Open questions I still have: ${e.questions}\n\n` : ""}Explain the concepts more deeply, correct anything I got wrong, and give one concrete example.`,
  },
  {
    id: "quiz",
    label: "Quiz me",
    build: (e) =>
      `Quiz me on "${e.title}" (${(e.tags ?? []).join(", ")}). My notes:\n\n${e.content ?? ""}\n\nAsk me 5 questions one at a time, wait for my answer, then give feedback. Start easy and get harder.`,
  },
  {
    id: "flashcards",
    label: "Make flashcards",
    build: (e) => `Turn these notes on "${e.title}" into 10 concise Anki-style flashcards (Q/A):\n\n${e.content ?? ""}`,
  },
  {
    id: "next",
    label: "What next?",
    build: (e) =>
      `I just learned about "${e.title}":\n\n${e.content ?? ""}\n\nWhat should I learn next to build on this? Give me a short roadmap with 3-5 steps and one free resource for each.`,
  },
  {
    id: "project",
    label: "Practice project",
    build: (e) =>
      `Suggest a small hands-on project (2-4 hours) to practise "${e.title}". My notes:\n\n${e.content ?? ""}\n\nInclude goals, steps, and how to know I've succeeded.`,
  },
];

const MAX = 1800;
const clip = (s: string) => (s.length > MAX ? `${s.slice(0, MAX)}…` : s);

export function chatgptUrl(prompt?: string) {
  return prompt ? `https://chatgpt.com/?q=${encodeURIComponent(clip(prompt))}` : "https://chatgpt.com";
}

export function claudeUrl(prompt?: string) {
  return prompt ? `https://claude.ai/new?q=${encodeURIComponent(clip(prompt))}` : "https://claude.ai";
}

export function AiLinkButtons({ prompt, className, size = "md" }: { prompt?: string; className?: string; size?: "sm" | "md" }) {
  const base = cn(
    "inline-flex items-center gap-1.5 rounded-lg border font-medium transition-colors",
    size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]",
  );
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      <a href={chatgptUrl(prompt)} target="_blank" rel="noreferrer" className={cn(base, "border-[#10a37f]/35 bg-[#10a37f]/10 text-[#10a37f] hover:bg-[#10a37f]/15 dark:text-[#3ecf9f]")}>
        <MessageCircle className="h-3.5 w-3.5" /> ChatGPT <ExternalLink className="h-3 w-3 opacity-70" />
      </a>
      <a href={claudeUrl(prompt)} target="_blank" rel="noreferrer" className={cn(base, "border-[#d97757]/35 bg-[#d97757]/10 text-[#c2410c] hover:bg-[#d97757]/15 dark:text-[#e8916f]")}>
        <Sparkle className="h-3.5 w-3.5" /> Claude <ExternalLink className="h-3 w-3 opacity-70" />
      </a>
    </div>
  );
}
