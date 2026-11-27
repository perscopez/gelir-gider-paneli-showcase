"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NavLinks, type NavItem } from "./nav-links";

export function MobileNav({ items, title }: { items: NavItem[]; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className="lg:hidden" aria-label="Menü" />}>
        <Menu className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 gap-2 p-4">
        <SheetHeader className="p-0 pb-2"><SheetTitle>{title}</SheetTitle></SheetHeader>
        <NavLinks items={items} onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
