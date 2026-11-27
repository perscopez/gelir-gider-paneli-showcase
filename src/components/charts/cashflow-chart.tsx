"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type CashflowPoint = { label: string; income: number; expense: number };

export function CashflowChart({ data, labels, locale }: { data: CashflowPoint[]; labels: { income: string; expense: string }; locale: string }) {
  const config = {
    income: { label: labels.income, color: "var(--chart-1)" },
    expense: { label: labels.expense, color: "var(--chart-2)" },
  } satisfies ChartConfig;
  const loc = locale === "tr" ? "tr-TR" : "en-GB";
  const money = new Intl.NumberFormat(loc, { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  const money2 = new Intl.NumberFormat(loc, { style: "currency", currency: "EUR" });
  return (
    <ChartContainer config={config} className="h-64 w-full">
      <BarChart data={data} barGap={4} margin={{ left: 0, right: 0, top: 8 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={(v: number) => money.format(v)} />
        <ChartTooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={
            <ChartTooltipContent
              formatter={(value, name) => (
                <div className="flex w-full items-center justify-between gap-6">
                  <span className="text-muted-foreground">{name === "income" ? labels.income : labels.expense}</span>
                  <span className="tnum font-medium">{money2.format(Number(value))}</span>
                </div>
              )}
            />
          }
        />
        <Bar dataKey="income" fill="var(--color-income)" radius={[6, 6, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expense" fill="var(--color-expense)" radius={[6, 6, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartContainer>
  );
}
