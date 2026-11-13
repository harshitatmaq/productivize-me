import { Suspense } from "react";
import { ShareView } from "@/components/share/share-view";

export const metadata = { title: "Save to Productivize" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function SharePage() {
  return (
    <Suspense>
      <ShareView />
    </Suspense>
  );
}
