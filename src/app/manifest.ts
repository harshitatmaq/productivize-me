import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Productivize",
    short_name: "Productivize",
    description: "Tasks that carry forward, reminders, a learning log, an AI job scout and your portfolio.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["window-controls-overlay", "standalone"],
    orientation: "portrait",
    background_color: "#08090a",
    theme_color: "#08090a",
    categories: ["productivity", "education", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // Android: Share → Productivize (job links go straight to the tracker)
    share_target: {
      action: "/share",
      method: "get",
      params: { title: "title", text: "text", url: "url" },
    },
    shortcuts: [
      { name: "Today", url: "/", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Log learning", short_name: "Learn", url: "/learning?new=1", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Job matches", short_name: "Jobs", url: "/jobs", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
