import { Banknote, CreditCard, Landmark, Lock, PiggyBank, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = { bank: Landmark, cash: Banknote, credit_card: CreditCard, blocked: Lock, reserve: PiggyBank };

export function AccountIcon({ type, className = "" }: { type: string; className?: string }) {
  const Icon = ICONS[type] ?? Landmark;
  return (
    <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ${className}`}>
      <Icon className="size-4" aria-hidden />
    </div>
  );
}
