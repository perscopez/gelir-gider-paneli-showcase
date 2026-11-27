import { describe, expect, it } from "vitest";
import { aliasKey, merchantKey } from "@/lib/alias";

describe("merchantKey", () => {
  it("bilinen marketler kısa anahtara iner", () => {
    expect(merchantKey("LIDL Berlin Mitte")).toBe("lidl");
    expect(merchantKey("ALDI SÜD")).toBe("aldi");
    expect(merchantKey("REWE Markt GmbH")).toBe("rewe");
  });
  it("bilinmeyen market sadeleşir, boş girdi boş döner", () => {
    expect(merchantKey("Kiosk Müller!")).toBe("kiosk müller");
    expect(merchantKey(null)).toBe("");
    expect(merchantKey("")).toBe("");
  });
});

describe("aliasKey", () => {
  it("büyük/küçük harf ve noktalama fark etmez", () => {
    expect(aliasKey("VOLLM. 3,5% 1L")).toBe(aliasKey("vollm 3 5 1l"));
    expect(aliasKey("  Red   Bull  ")).toBe("red bull");
  });
  it("80 karakterle sınırlı", () => expect(aliasKey("a".repeat(200)).length).toBe(80));
});
