import { InterestsView } from "@/components/interests/interests-view";

export const metadata = { title: "Interests" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function InterestsPage() {
  return <InterestsView />;
}
