import { storeFor } from "@/lib/product-lookup";

// Eşleştirme anahtarları: market (lidl/rewe/...) ve fişteki ad (küçük harf, sadeleştirilmiş).
export const merchantKey = (m?: string | null) => (m ? storeFor(m)?.id ?? m.toLowerCase().replace(/[^a-z0-9ğüşıöç]+/g, " ").trim().slice(0, 40) : "");
export const aliasKey = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9äöüßğşıçé]+/g, " ").trim().slice(0, 80);
