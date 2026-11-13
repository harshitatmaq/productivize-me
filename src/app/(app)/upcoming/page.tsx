import { UpcomingView } from "@/components/planner/upcoming-view";

export const metadata = { title: "Upcoming" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function UpcomingPage() {
  return <UpcomingView />;
}
