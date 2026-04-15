"use client";

import { useEffect, useState } from "react";
import { AppNav } from "./AppNav";
import { AppTopBar } from "./AppTopBar";

const COLLAPSED_KEY = "app-nav-collapsed";

export function AppShell({
  title,
  subtitle,
  actions,
  children,
  footer,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored === "1") setCollapsed(true);
    setMounted(true);
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div className="h-screen flex overflow-hidden">
      {mounted && <AppNav collapsed={collapsed} onToggleCollapsed={toggle} />}
      {!mounted && <div className="w-52 shrink-0 border-r bg-muted/20" />}
      <div className="flex-1 flex flex-col min-w-0">
        <AppTopBar title={title} subtitle={subtitle} actions={actions} />
        <div className="flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer}
      </div>
    </div>
  );
}
