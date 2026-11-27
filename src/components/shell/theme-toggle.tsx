"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ThemeToggle({ labels }: { labels: { light: string; dark: string; system: string; theme: string } }) {
  const { setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={labels.theme} />}>
        <Sun className="size-4 scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
        <Moon className="absolute size-4 scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}><Sun className="size-4" /> {labels.light}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}><Moon className="size-4" /> {labels.dark}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}><Monitor className="size-4" /> {labels.system}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
