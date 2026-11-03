import { Suspense } from "react";
import { ShareView } from "@/components/share/share-view";

export const metadata = { title: "Save to Productivize" };

export default function SharePage() {
  return (
    <Suspense>
      <ShareView />
    </Suspense>
  );
}
