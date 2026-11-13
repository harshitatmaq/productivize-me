import { Suspense } from "react";
import { JobsView } from "@/components/jobs/jobs-view";

export const metadata = { title: "Jobs" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function JobsPage() {
  return (
    <Suspense>
      <JobsView />
    </Suspense>
  );
}
