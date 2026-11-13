import { Suspense } from "react";
import { RemindersView } from "@/components/planner/reminders-view";

export const metadata = { title: "Reminders" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function RemindersPage() {
  return (
    <Suspense>
      <RemindersView />
    </Suspense>
  );
}
