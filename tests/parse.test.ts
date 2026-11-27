import { describe, expect, it } from "vitest";
import { parseMoney, parseQuick } from "@/lib/parse";

describe("parseQuick", () => {
  it("gider: tutar + açıklama", () => expect(parseQuick("45 market")).toEqual({ kind: "expense", amount: 45, currency: undefined, merchant: "market", accountHint: undefined }));
  it("ondalık virgül/nokta", () => {
    expect(parseQuick("12,5 kahve")?.amount).toBe(12.5);
    expect(parseQuick("12.5 kahve")?.amount).toBe(12.5);
  });
  it("+ ile gelir, para birimi ve @hesap", () => {
    expect(parseQuick("+1200 try freelance lale @lalebank")).toMatchObject({ kind: "income", amount: 1200, currency: "TRY", accountHint: "lalebank" });
  });
  it("EUR eş anlamlıları", () => {
    for (const c of ["eur", "euro", "€"]) expect(parseQuick(`10 ${c} su`)?.currency).toBe("EUR");
    for (const c of ["try", "tl", "₺"]) expect(parseQuick(`10 ${c} su`)?.currency).toBe("TRY");
  });
  it("anlamsız metin null", () => expect(parseQuick("merhaba")).toBeNull());
});

describe("parseMoney", () => {
  it.each([
    ["€12,50", 12.5, "EUR"],
    ["12.50 EUR", 12.5, "EUR"],
    ["1.234,56 ₺", 1234.56, "TRY"],
    ["₺1,234.50", 1234.5, "TRY"],
    ["1.234 TL", 1234, "TRY"], // tek ayraç + 3 hane = binlik
    ["5.000 TL", 5000, "TRY"],
    ["7,5", 7.5, undefined],
    ["1,234,567.89", 1234567.89, undefined],
  ])("%s", (input, amount, currency) => expect(parseMoney(input)).toEqual({ amount, currency }));
  it("sayı: işaret atılır, 0 reddedilir", () => {
    expect(parseMoney(-3.2)).toEqual({ amount: 3.2 });
    expect(parseMoney(0)).toBeNull();
  });
  it("tutar yoksa null", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
});
