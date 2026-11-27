import { describe, expect, it } from "vitest";
import { httpUrl } from "@/lib/product-lookup";
import { safeEqual } from "@/lib/auth-secret";

describe("httpUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(httpUrl("https://images.example.com/a.jpg")).toBe("https://images.example.com/a.jpg");
    expect(httpUrl("http://example.com/p")).toBe("http://example.com/p");
  });
  it("rejects script and data URLs", () => {
    expect(httpUrl("javascript:alert(1)")).toBeNull();
    expect(httpUrl(" JavaScript:alert(1)")).toBeNull();
    expect(httpUrl("data:text/html,<script>1</script>")).toBeNull();
  });
  it("rejects empty and relative values", () => {
    expect(httpUrl(null)).toBeNull();
    expect(httpUrl("")).toBeNull();
    expect(httpUrl("/relative/path")).toBeNull();
  });
});

describe("safeEqual", () => {
  it("fails closed when the secret is not configured", () => {
    expect(safeEqual("anything", undefined)).toBe(false);
    expect(safeEqual(null, "secret")).toBe(false);
  });
  it("compares exact values only", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret2", "secret")).toBe(false);
  });
});
