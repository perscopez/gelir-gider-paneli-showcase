// Fiş satırı gerçek bir ürün mü, yoksa indirim/depozito/poşet gibi bir ek satır mı? Ek satırlar için ürün fotoğrafı aranmaz, simge gösterilir.
export type LineKind = "product" | "discount" | "deposit" | "bag" | "other";

const DISCOUNT = /rabatt|coupon|kupon|gutschein|preisvorteil|preisnachlass|nachlass|aktionspreis|aktion\b|ersparnis|indirim|iskonto|lidl\s*plus|payback|bonus|sofortrabatt/i;
const DEPOSIT = /pfand|leergut|einweg|mehrweg|depozito|depozit/i;
const BAG = /tragetasche|tragetüte|trageta|tüte\b|poşet|poset|plastiktüte|papiertüte|\btasche\b/i;

export function lineKind(l: { name: string; product?: string | null; category: string; line_total: number }): LineKind {
  const text = `${l.name} ${l.product ?? ""}`.replace(/İ/g, "i"); // Türkçe büyük İ, küçük harfe çevrilince i + nokta olur: önce düzelt
  if (l.category === "İndirim" || DISCOUNT.test(text) || l.line_total < 0) return "discount";
  if (l.category.startsWith("Depozito") || DEPOSIT.test(text)) return "deposit";
  if (BAG.test(text)) return "bag";
  return "product";
}
