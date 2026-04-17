"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  BarChart3,
  Package,
  AlertTriangle,
  GitCommit,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Workflow,
  Tags,
  Library,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTicketData } from "@/lib/ticket-data-context";
import { useMemo } from "react";
import { buildRisksList } from "@/lib/risks-utils";
import { detectChanges, getWindowStart } from "@/lib/standup-changes-utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeTone?: "neutral" | "warn" | "danger";
  matchPrefix?: boolean;
  indent?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export function AppNav({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const pathname = usePathname();
  const {
    tickets,
    teamMembers,
    isStale,
    standupTime,
    standupTimezone,
  } = useTicketData();

  const risksCount = useMemo(
    () => buildRisksList(tickets, teamMembers, isStale).length,
    [tickets, teamMembers, isStale]
  );

  const changesCount = useMemo(() => {
    const since = getWindowStart("since-standup", standupTime, standupTimezone);
    return detectChanges(tickets, teamMembers, since).length;
  }, [tickets, teamMembers, standupTime, standupTimezone]);

  const onReleases = pathname.startsWith("/releases");

  const groups: NavGroup[] = [
    {
      label: "Daily",
      items: [
        { href: "/", label: "Standup", icon: Home },
        {
          href: "/changes",
          label: "Changes",
          icon: GitCommit,
          badge: changesCount,
          badgeTone: "neutral",
        },
        {
          href: "/risks",
          label: "Risks",
          icon: AlertTriangle,
          badge: risksCount,
          badgeTone: "danger",
        },
      ],
    },
    {
      label: "Delivery",
      items: [
        { href: "/progress", label: "Progress", icon: BarChart3 },
        {
          href: "/releases",
          label: "Releases",
          icon: Package,
          matchPrefix: true,
        },
        ...(onReleases
          ? [
              {
                href: "/releases/workflows",
                label: "Workflows",
                icon: Workflow,
                matchPrefix: true,
                indent: true,
              },
              {
                href: "/releases/categories",
                label: "Categories",
                icon: Tags,
                matchPrefix: true,
                indent: true,
              },
              {
                href: "/releases/task-library",
                label: "Task library",
                icon: Library,
                matchPrefix: true,
                indent: true,
              },
            ]
          : []),
      ],
    },
  ];

  const footer: NavItem[] = [
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <nav
      className={cn(
        "flex flex-col border-r bg-muted/20 shrink-0 transition-[width] duration-150",
        collapsed ? "w-12" : "w-52"
      )}
    >
      <div
        className={cn(
          "flex items-center h-11 border-b shrink-0",
          collapsed ? "justify-center" : "justify-between px-3"
        )}
      >
        {!collapsed && (
          <span className="text-sm font-semibold tracking-tight">TPM Hub</span>
        )}
        <button
          onClick={onToggleCollapsed}
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title={collapsed ? "Expand nav" : "Collapse nav"}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? (
            <ChevronsRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronsLeft className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            {!collapsed && (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
            )}
            <div className="flex flex-col gap-0.5 px-1.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  collapsed={collapsed}
                  pathname={pathname}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t py-2">
        <div className="flex flex-col gap-0.5 px-1.5">
          {footer.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              collapsed={collapsed}
              pathname={pathname}
            />
          ))}
        </div>
      </div>
    </nav>
  );
}

function NavLink({
  item,
  collapsed,
  pathname,
}: {
  item: NavItem;
  collapsed: boolean;
  pathname: string;
}) {
  const active = item.matchPrefix
    ? item.href === "/releases"
      ? pathname === "/releases" ||
        (pathname.startsWith("/releases/") &&
          !pathname.startsWith("/releases/workflows") &&
          !pathname.startsWith("/releases/categories") &&
          !pathname.startsWith("/releases/task-library"))
      : pathname === item.href || pathname.startsWith(item.href + "/")
    : pathname === item.href;

  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group flex items-center gap-2 h-8 rounded-md text-xs transition-colors",
        collapsed ? "justify-center px-0" : "px-2",
        item.indent && !collapsed && "pl-7",
        active
          ? "bg-muted text-foreground font-medium"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.badge != null && item.badge > 0 && (
        <span
          className={cn(
            "ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full px-1 text-[10px] font-semibold tabular-nums",
            item.badgeTone === "danger" &&
              "bg-red-500/15 text-red-600 dark:text-red-400",
            item.badgeTone === "warn" &&
              "bg-amber-500/15 text-amber-600 dark:text-amber-400",
            (!item.badgeTone || item.badgeTone === "neutral") &&
              "bg-blue-500/15 text-blue-600 dark:text-blue-400"
          )}
        >
          {item.badge}
        </span>
      )}
    </Link>
  );
}
