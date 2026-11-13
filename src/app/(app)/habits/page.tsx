import { HabitsView } from "@/components/habits/habits-view";

export const metadata = { title: "Habits" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function HabitsPage() {
  return <HabitsView />;
}
