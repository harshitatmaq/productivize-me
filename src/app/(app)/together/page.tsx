import { TogetherView } from "@/components/together/together-view";

export const metadata = { title: "Together" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function TogetherPage() {
  return <TogetherView />;
}
