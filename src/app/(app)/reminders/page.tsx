import { Suspense } from "react";
import { RemindersView } from "@/components/planner/reminders-view";

export const metadata = { title: "Reminders" };

export default function RemindersPage() {
  return (
    <Suspense>
      <RemindersView />
    </Suspense>
  );
}
