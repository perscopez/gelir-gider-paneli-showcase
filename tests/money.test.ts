import { describe, expect, it } from "vitest";
import { fmt, toEur, toTry } from "@/lib/money";

describe("kur çevirisi", () => {
  it("TRY → EUR böler, EUR → TRY çarpar", () => {
    expect(toEur(550, "TRY", 55)).toBe(10);
    expect(toTry(10, "EUR", 55)).toBe(550);
  });
  it("aynı para birimi değişmez", () => {
    expect(toEur(12.34, "EUR", 55)).toBe(12.34);
    expect(toTry(99, "TRY", 55)).toBe(99);
  });
  it("gidiş-dönüş tutarlı", () => expect(toEur(toTry(7.77, "EUR", 36.4), "TRY", 36.4)).toBeCloseTo(7.77, 10));
});

describe("fmt", () => {
  it("para birimi ve dil", () => {
    expect(fmt(1234.5, "EUR", "tr")).toContain("1.234,50");
    expect(fmt(1234.5, "EUR", "en")).toContain("1,234.50");
    expect(fmt(10, "TRY", "tr")).toContain("₺");
  });
});
