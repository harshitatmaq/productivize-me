import { Suspense } from "react";
import { WelcomeForm } from "./welcome-form";

export const metadata = { title: "Welcome" };

export default function WelcomePage() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] glow-top" />
      <Suspense>
        <WelcomeForm />
      </Suspense>
    </div>
  );
}
