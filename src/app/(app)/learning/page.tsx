import { Suspense } from "react";
import { LearningView } from "@/components/learning/learning-view";

export const metadata = { title: "Learning" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function LearningPage() {
  return (
    <Suspense>
      <LearningView />
    </Suspense>
  );
}
