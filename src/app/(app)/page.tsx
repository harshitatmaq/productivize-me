import { Suspense } from "react";
import { TodayView } from "@/components/today/today-view";

export default function TodayPage() {
  return (
    <Suspense>
      <TodayView />
    </Suspense>
  );
}
