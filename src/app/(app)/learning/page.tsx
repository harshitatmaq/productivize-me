import { Suspense } from "react";
import { LearningView } from "@/components/learning/learning-view";

export const metadata = { title: "Learning" };

export default function LearningPage() {
  return (
    <Suspense>
      <LearningView />
    </Suspense>
  );
}
