import type { ReactNode } from "react";

export const inputCls =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";

// Her form alanı görünür bir etiketle gelir; ipucu varsa altına yazılır.
export function Field({ label, hint, className = "", children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={`grid content-start gap-1.5 text-sm ${className}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted-foreground/80">{hint}</span> : null}
    </label>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">{children}</p>;
}
