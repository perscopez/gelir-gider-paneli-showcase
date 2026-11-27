import {
  Banknote, Bus, CircleDollarSign, Clapperboard, GraduationCap, HeartPulse, Home, Plane, Receipt, Repeat, ShoppingBag, ShoppingBasket, Utensils, ArrowLeftRight, Gift, type LucideIcon,
} from "lucide-react";

const MAP: [RegExp, LucideIcon][] = [
  [/market|grocer/i, ShoppingBasket], [/yemek|eating|restaurant/i, Utensils], [/ulaşım|transport/i, Bus], [/kira|rent/i, Home],
  [/fatura|bill/i, Receipt], [/abonelik|subscription/i, Repeat], [/sağlık|health/i, HeartPulse], [/alışveriş|shopping/i, ShoppingBag],
  [/eğlence|entertain/i, Clapperboard], [/seyahat|travel/i, Plane], [/eğitim|educat/i, GraduationCap], [/aile|family/i, Gift],
  [/bloke|blocked|freelance|gelir|income|payout/i, Banknote],
];

const ALL: LucideIcon[] = [...new Set<LucideIcon>([...MAP.map(([, i]) => i), CircleDollarSign, ArrowLeftRight])];

function pick(name?: string | null, kind?: string): LucideIcon {
  if (kind === "transfer") return ArrowLeftRight;
  if (!name) return CircleDollarSign;
  return MAP.find(([re]) => re.test(name))?.[1] ?? CircleDollarSign;
}

// İkonu modül düzeyindeki bir tablodan seçip JSX'te doğrudan yazarız (render içinde bileşen oluşturmamak için).
export function CategoryIcon({ name, kind, className = "" }: { name?: string | null; kind?: string; className?: string }) {
  const icon = pick(name, kind);
  const idx = ALL.indexOf(icon);
  return (
    <div className={`flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ${className}`}>
      {ALL.map((I, i) => (i === idx ? <I key={i} className="size-4" aria-hidden /> : null))}
    </div>
  );
}
