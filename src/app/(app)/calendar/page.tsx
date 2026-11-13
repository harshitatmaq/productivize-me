import { CalendarView } from "@/components/planner/calendar-view";

export const metadata = { title: "Calendar" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function CalendarPage() {
  return <CalendarView />;
}
