import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label, value, sub, icon: Icon, tone = "default", hint,
}: { label: string; value: string; sub?: string; icon?: LucideIcon; tone?: "default" | "positive" | "negative"; hint?: string }) {
  return (
    <Card size="sm">
      <CardContent className="space-y-1">
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{label}</span>
          {Icon ? <Icon className="size-4" aria-hidden /> : null}
        </div>
        <div className={cn("tnum text-2xl font-semibold tracking-tight", tone === "positive" && "text-positive", tone === "negative" && "text-negative")}>{value}</div>
        {sub ? <div className="tnum text-xs text-muted-foreground">{sub}</div> : null}
        {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
