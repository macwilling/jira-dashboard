import { Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell/AppShell";

export default function Loading() {
  return (
    <AppShell title="Release">
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    </AppShell>
  );
}
