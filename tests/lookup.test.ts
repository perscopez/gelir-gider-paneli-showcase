import { describe, expect, it } from "vitest";
import { levelOf, score, storeFor, tokens } from "@/lib/product-lookup";
import { merchantsOverlap } from "@/lib/merge";
import { brandInText, ownBrandsFor } from "@/lib/store-brands";
import { dealRelevant, kaufdaSlug } from "@/lib/kaufda";

describe("eşleşme puanı", () => {
  it("Bananen ≠ Bananenchips", () => {
    expect(score({ name: "Bananen" }, { title: "Bananen" })).toBeGreaterThan(score({ name: "Bananen" }, { title: "Bananenchips" }));
    expect(levelOf(score({ name: "Bananen" }, { title: "Bananenchips" }))).not.toBe("high");
  });
  it("bitişik/ayrı yazım: Redbull = Red Bull", () => expect(score({ name: "Redbull" }, { title: "Red Bull", brands: "Red Bull" })).toBeGreaterThanOrEqual(0.55));
  it("marka ve market bonusu", () => {
    const base = score({ name: "Vollmilch", brand: "Milsani" }, { title: "Vollmilch", brands: "Milsani" });
    expect(base).toBeGreaterThan(score({ name: "Vollmilch", brand: "Milsani" }, { title: "Vollmilch", brands: "Weihenstephan" }));
  });
  it("kısa sorguda uzun alakasız başlık cezalı", () => expect(score({ name: "Redbull" }, { title: "BBURAGO F1 RedBull 4-fach Weltmeister Sonder-Edition Spielzeugauto" })).toBeLessThan(0.55));
  it("seviyeler", () => {
    expect(levelOf(0.9)).toBe("high");
    expect(levelOf(0.6)).toBe("medium");
    expect(levelOf(0.45)).toBe("low");
    expect(levelOf(0.2)).toBeNull();
  });
  it("tokens: boyut ve dolgu kelimeleri atılır", () => expect(tokens("Bio Vollmilch 1,5 l")).toEqual(["vollmilch"]));
});

describe("market tanıma", () => {
  it("storeFor", () => {
    expect(storeFor("LIDL SAGT DANKE")?.id).toBe("lidl");
    expect(storeFor("Kaufland Berlin")?.id).toBe("kaufland");
    expect(storeFor("Bilinmeyen")).toBeNull();
  });
  it("özel marka", () => {
    expect(brandInText("MILBONA JOGHURT 500G")).toBe("Milbona");
    expect(brandInText("Vollmilch")).toBeNull();
    expect(ownBrandsFor("lidl")).toContain("Milbona");
  });
});

describe("Apple Pay ↔ fiş mağaza adı eşleşmesi", () => {
  it("benzer adlar", () => {
    expect(merchantsOverlap("LIDL SAGT DANKE", "Lidl")).toBe(true);
    expect(merchantsOverlap("REWE Markt GmbH", "REWE")).toBe(true);
  });
  it("farklı mağazalar", () => {
    expect(merchantsOverlap("LIDL SAGT DANKE", "REWE")).toBe(false);
    expect(merchantsOverlap(null, "Lidl")).toBe(false);
  });
});

describe("KaufDA", () => {
  it("slug: Almanca karakterler ve boşluklar", () => {
    expect(kaufdaSlug("Hähnchenbrust")).toBe("Haehnchenbrust");
    expect(kaufdaSlug("red bull")).toBe("Red-Bull");
    expect(kaufdaSlug("Gut & Günstig")).toBe("Gut-Guenstig");
  });
  it("fırsat ilgisi: bileşik kelime evet, tatlı/oyuncak hayır", () => {
    expect(dealRelevant({ name: "Hähnchenbrust" }, "Frische Hähnchenbrustfilets Teilstücke")).toBe(true);
    expect(dealRelevant({ name: "Vollmilch" }, "Schoko Vollmilch Tafel")).toBe(false);
    expect(dealRelevant({ name: "Eier" }, 'Geschenkset "Reh" Make-up Eier 3tlg')).toBe(false);
    expect(dealRelevant({ name: "Bananen" }, "WWF-Bananen")).toBe(true);
  });
});

import { suggestCategoryName } from "@/lib/statements/categorize";
describe("ekstre kategori önerisi", () => {
  it("yazılım/bulut abonelikleri", () => {
    for (const m of ["NETFLIX.COM", "SPOTIFY P0000DEMO", "GITHUB SPONSORS", "APPLE.COM/BILL"]) expect(suggestCategoryName(m)).toBe("Abonelikler");
    expect(suggestCategoryName("TRENDYOL")).toBeNull();
  });
});
