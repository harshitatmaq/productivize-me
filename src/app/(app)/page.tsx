import { Suspense } from "react";
import { TodayView } from "@/components/today/today-view";

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function TodayPage() {
  return (
    <Suspense>
      <TodayView />
    </Suspense>
  );
}
