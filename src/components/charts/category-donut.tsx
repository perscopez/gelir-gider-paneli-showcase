"use client";

import { Label, Pie, PieChart } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type DonutSlice = { name: string; value: number; fill: string };

export function CategoryDonut({ data, total, totalLabel, locale }: { data: DonutSlice[]; total: number; totalLabel: string; locale: string }) {
  const config: ChartConfig = Object.fromEntries(data.map((d) => [d.name, { label: d.name, color: d.fill }]));
  const loc = locale === "tr" ? "tr-TR" : "en-GB";
  const money = new Intl.NumberFormat(loc, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat(loc, { style: "currency", currency: "EUR" });
  return (
    <ChartContainer config={config} className="mx-auto aspect-square h-52">
      <PieChart>
        <ChartTooltip
          content={
            <ChartTooltipContent
              hideLabel
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-6">
                  <span className="text-muted-foreground">{String(name)}</span>
                  <span className="tnum font-medium">{money2.format(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={62} outerRadius={88} paddingAngle={2} strokeWidth={0}>
          <Label
            content={({ viewBox }) => {
              if (!viewBox || !("cx" in viewBox) || viewBox.cx === undefined || viewBox.cy === undefined) return null;
              return (
                <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                  <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) - 6} className="fill-foreground text-xl font-semibold">{money.format(total)}</tspan>
                  <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 14} className="fill-muted-foreground text-xs">{totalLabel}</tspan>
                </text>
              );
            }}
          />
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
