// Market fişi kalemleri için alt kategori listesi ve fiyat karşılaştırma birimi hesabı.
export const GROCERY_CATEGORIES = [
  "Meyve & Sebze", "Et, Tavuk & Balık", "Süt, Yumurta & Peynir", "Ekmek & Fırın", "Kahvaltılık",
  "Kuru Gıda & Bakliyat", "Konserve & Hazır Yemek", "Dondurulmuş", "Baharat, Yağ & Soslar",
  "Atıştırmalık & Tatlı", "İçecek (alkolsüz)", "Alkol", "Temizlik", "Kişisel Bakım & Sağlık",
  "Ev & Mutfak", "Bebek", "Evcil Hayvan", "Depozito (Pfand)", "İndirim", "Diğer",
] as const;

export type GroceryCategory = (typeof GROCERY_CATEGORIES)[number];

export type ReceiptItem = {
  name: string;
  product: string | null;
  brand: string | null;
  quantity: number;
  unit: string | null;
  packAmount: number | null;
  packUnit: string | null;
  unitPrice: number | null;
  lineTotal: number;
  category: GroceryCategory;
};

const BASE: Record<string, { base: "kg" | "l"; mult: number }> = {
  kg: { base: "kg", mult: 1 }, g: { base: "kg", mult: 0.001 }, l: { base: "l", mult: 1 }, ml: { base: "l", mult: 0.001 }, cl: { base: "l", mult: 0.01 },
};

// Aynı ürünü farklı mağaza/ambalajda karşılaştırmak için € / kg, € / l ya da € / adet.
export function pricePerBase(i: Pick<ReceiptItem, "quantity" | "unit" | "packAmount" | "packUnit" | "lineTotal" | "category">) {
  if (i.lineTotal <= 0 || i.category === "İndirim" || i.category === "Depozito (Pfand)") return { baseUnit: null, pricePerBase: null };
  const u = i.unit?.toLowerCase() ?? "";
  if (BASE[u] && i.quantity > 0) {
    const amount = i.quantity * BASE[u].mult;
    return { baseUnit: BASE[u].base, pricePerBase: round(i.lineTotal / amount, 4) };
  }
  const pu = i.packUnit?.toLowerCase() ?? "";
  if (BASE[pu] && i.packAmount && i.packAmount > 0 && i.quantity > 0) {
    const amount = i.packAmount * BASE[pu].mult * i.quantity;
    return { baseUnit: BASE[pu].base, pricePerBase: round(i.lineTotal / amount, 4) };
  }
  if (i.quantity > 0) return { baseUnit: "pcs", pricePerBase: round(i.lineTotal / i.quantity, 4) };
  return { baseUnit: null, pricePerBase: null };
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
