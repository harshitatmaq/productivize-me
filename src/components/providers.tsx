"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/menu";
import { makeQueryClient } from "@/lib/queries/client";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={(resolvedTheme as "dark" | "light") ?? "dark"}
      position="bottom-right"
      offset={{ bottom: 88 }}
      mobileOffset={{ bottom: 88 }}
      toastOptions={{
        style: {
          background: "var(--panel)",
          border: "1px solid var(--line-strong)",
          color: "var(--fg)",
          fontSize: 13,
          borderRadius: 12,
        },
      }}
    />
  );
}

function ServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production" && !process.env.NEXT_PUBLIC_SW_IN_DEV) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
    // Messages from the service worker (e.g. after a notification action)
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "navigate" && typeof e.data.url === "string") window.location.assign(e.data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeQueryClient);
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          {children}
          <ServiceWorker />
          <ThemedToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
