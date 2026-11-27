// Alman marketlerinin özel (private label) markaları. Fişlerde çoğu zaman marka yazmaz; market bilinince marka tahmini ve eşleşme puanı için kullanılır.
// Liste elle derlenmiştir, eksiksiz olduğu garanti edilmez; eksik marka eklemek için buraya yazmak yeter.
export const STORE_BRANDS: Record<string, string[]> = {
  lidl: ["Milbona", "Pilos", "Deluxe", "Chef Select", "Freeway", "Fairglobe", "Vitasia", "Italiamo", "Cien", "W5", "Formil", "Lupilu", "Crivit", "Silvercrest", "Bio Organic", "Sondey", "Maribel", "Saltletts", "Eridanous"],
  aldi: ["Milsani", "GutBio", "Mühlengold", "Mamia", "Lacura", "Choceur", "Moser Roth", "Almare", "Meine Metzgerei", "Tandil"],
  rewe: ["ja!", "REWE Beste Wahl", "REWE Bio", "REWE Feine Welt", "REWE Regional"],
  edeka: ["Gut & Günstig", "Edeka Bio", "Herzstücke", "Gutfried", "Elbgold"],
  kaufland: ["K-Classic", "K-Bio", "K-Purland", "K-take it veggie"],
  penny: ["Berida", "Naturgut"],
  dm: ["dmBio", "Balea", "Denkmit", "Alverde", "Babylove", "Sundance", "Profissimo"],
  rossmann: ["Isana", "Alterra", "Domol", "Babydream", "Sunozon"],
};

export const ownBrandsFor = (storeId?: string | null) => (storeId ? STORE_BRANDS[storeId] ?? [] : []);

const foldB = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "");
// Fişteki ham satırda bilinen bir özel marka geçiyorsa onu döndürür (örn. "MILBONA JOGHURT 500G" -> "Milbona").
export function brandInText(text: string): string | null {
  const t = foldB(text);
  for (const list of Object.values(STORE_BRANDS)) for (const b of list) { const f = foldB(b); if (f.length >= 4 && t.includes(f)) return b; }
  return null;
}

// Yapay zekaya verilecek kısa özet (kısaltma açma ve marka tahmini için).
export const brandsForPrompt = () => Object.entries(STORE_BRANDS).map(([s, b]) => `${s}: ${b.join(", ")}`).join("; ");
