import { HealthView } from "@/components/health/health-view";

export const metadata = { title: "Health" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function HealthPage() {
  return <HealthView />;
}
