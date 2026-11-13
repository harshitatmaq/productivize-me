import { SettingsView } from "@/components/settings/settings-view";

export const metadata = { title: "Settings" };

// Signed-in pages render in the browser (see AppShell), so there's nothing for
// Next's instant-navigation check to validate here.
export const instant = false;

export default function SettingsPage() {
  return <SettingsView />;
}
