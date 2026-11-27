"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeftRight, Bell, Flag, LayoutDashboard, PiggyBank, Repeat, Settings, Tags, BadgePercent, Plug, ShoppingBasket, Upload, Wallet, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "/": LayoutDashboard, "/transactions": ArrowLeftRight, "/accounts": Wallet, "/budgets": PiggyBank, "/groceries": ShoppingBasket, "/deals": BadgePercent, "/goals": Flag,
  "/recurring": Repeat, "/notifications": Bell, "/rules": Tags, "/import": Upload, "/integrations": Plug, "/settings": Settings,
};

export type NavItem = { href: string; label: string };

export function NavLinks({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="grid gap-0.5" aria-label="Ana menü">
      {items.map(({ href, label }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        const Icon = ICONS[href] ?? LayoutDashboard;
        return (
          <Link
            key={href}
            data-tour-nav={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className={cn("size-4", active && "text-primary")} aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
