import { describe, expect, it } from "vitest";
import { lineKind } from "@/lib/line-kind";

const k = (name: string, category = "Diğer", line_total = 1) => lineKind({ name, category, line_total });

describe("lineKind", () => {
  it.each(["Rabatt 10%", "Coupon", "Lidl Plus Rabatt", "Preisvorteil", "Gutschein", "İndirim", "Aktionspreis"])("indirim: %s", (n) => expect(k(n)).toBe("discount"));
  it("eksi tutar = indirim", () => expect(k("Bilinmeyen", "Diğer", -0.5)).toBe("discount"));
  it("kategori İndirim", () => expect(k("x", "İndirim")).toBe("discount"));
  it.each(["PFAND 0,25", "Leergut", "Einweg", "Mehrweg"])("depozito: %s", (n) => expect(k(n)).toBe("deposit"));
  it("kategori Depozito", () => expect(k("x", "Depozito (Pfand)")).toBe("deposit"));
  it.each(["Tragetasche", "Papiertüte", "Poşet"])("poşet: %s", (n) => expect(k(n)).toBe("bag"));
  it.each(["Vollmilch 1L", "Hähnchenbrust", "Red Bull Energy", "Bananen"])("ürün: %s", (n) => expect(k(n, "Süt, Yumurta & Peynir")).toBe("product"));
});
