// Ekstre satırı için kategori önerisi: önce kullanıcının kendi kuralları, sonra bu yerleşik sözlük.
// Değerler varsayılan kategori adlarıdır (Ayarlar > Varsayılan kategorileri ekle).
const BUILTIN: [RegExp, string][] = [
  [/\bfabrikam m\d+\b/i, "Bloke hesap ödemesi"],
  [/miete|mietzahlung|\brent\b/i, "Kira"],
  [/krankenkasse|versicherung|apotheke|arzt|\btk\b|aok|barmer/i, "Sağlık"],
  [/apple\.com\/bill|spotify|netflix|youtube|google \*|icloud|disney|prime video|\bdazn\b|adobe|microsoft|msbill|hetzner|openai|chatgpt|github|dropbox|notion|figma|cloudflare|digitalocean|namecheap|godaddy/i, "Abonelikler"],
  [/penny|lidl|rewe|edeka|aldi|netto|kaufland|rossmann|\bdm\b|dm drogerie|müller|spar\b|migros|bim\b|a101|şok/i, "Market"],
  [/starbucks|coffee|kaffee|cafe|café|bäckerei|backerei|baeckerei|mcdonald|burger|kebab|döner|doner|pizza|restaurant|bistro|lieferando|wolt|uber eats/i, "Dışarıda yemek"],
  [/\bbvg\b|\bdb\b|deutsche bahn|flixbus|bolt|\buber\b|s-bhf|bahn ticket|tier |lime/i, "Ulaşım"],
  [/amazon|zalando|ikea|tedi|karaca|h&m|primark|saturn|media ?markt|action\b|woolworth/i, "Alışveriş"],
  [/vodafone|telekom|o2|1&1|strom|gas\b|rundfunk|beitragsservice/i, "Faturalar"],
];

export function suggestCategoryName(merchant: string, note?: string | null): string | null {
  const hay = `${merchant} ${note ?? ""}`;
  for (const [re, name] of BUILTIN) if (re.test(hay)) return name;
  return null;
}
