"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";

export function AppTopBar({
  title,
  subtitle,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <header
      className={cn(
        "sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60",
        className
      )}
    >
      <div className="flex items-center gap-3 h-12 px-4">
        <div className="flex items-baseline gap-2 min-w-0">
          <h1 className="text-sm font-semibold tracking-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <span className="text-xs text-muted-foreground truncate">
              {subtitle}
            </span>
          )}
        </div>

        {actions && (
          <div className="flex items-center gap-1 flex-1 min-w-0">{actions}</div>
        )}

        <div
          className={cn(
            "flex items-center gap-1 shrink-0",
            !actions && "ml-auto"
          )}
        >
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Logout"
            aria-label="Logout"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
}
