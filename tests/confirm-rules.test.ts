import { describe, expect, it } from "vitest";
import { isConfirmRule, parsePaidData, paidData, pendingDue, reminderText, type ConfirmRule } from "@/lib/confirm-rules";

const rule = (o: Partial<ConfirmRule> = {}): ConfirmRule => ({
  id: "ae8d3ff5-1413-4d63-8d17-b1b89e48b39b", name: "Kira", kind: "expense", amount: 550, currency: "EUR", day_of_month: 2,
  start_date: "2026-11-03", end_date: null, last_run_on: null, remind_days_before: 3, auto_create: false, active: true, ...o,
});

describe("onaylı hatırlatma", () => {
  it("yalnızca 'sadece hatırlat' gider kuralları onaylıdır", () => {
    expect(isConfirmRule(rule())).toBe(true);
    expect(isConfirmRule(rule({ auto_create: true }))).toBe(false);
    expect(isConfirmRule(rule({ kind: "income" }))).toBe(false);
    expect(isConfirmRule(rule({ active: false }))).toBe(false);
  });
  it("vadeden 3 gün önce başlar, öncesinde sessiz", () => {
    expect(pendingDue(rule(), "2026-11-28")).toBeNull();
    expect(pendingDue(rule(), "2026-11-29")).toEqual({ due: "2026-12-02", daysUntil: 3 });
    expect(pendingDue(rule(), "2026-12-02")).toEqual({ due: "2026-12-02", daysUntil: 0 });
  });
  it("ödenmeyince gecikme olarak sürer; ödenince (last_run_on) susar", () => {
    expect(pendingDue(rule(), "2026-12-05")).toEqual({ due: "2026-12-02", daysUntil: -3 });
    expect(pendingDue(rule({ last_run_on: "2026-12-02" }), "2026-12-05")).toBeNull();
  });
  it("kasım vadesi başlangıç tarihinden önce olduğu için istenmez", () => expect(pendingDue(rule(), "2026-11-10")).toBeNull());
  it("mesaj metni ve tuş verisi", () => {
    expect(reminderText("Kira", "€550,00", "2026-12-02", 0)).toContain("bugün (02.12)");
    expect(reminderText("Kira", "€550,00", "2026-12-02", -2)).toContain("2 gün GECİKTİ");
    const d = paidData("ae8d3ff5-1413-4d63-8d17-b1b89e48b39b", "2026-12-02");
    expect(d.length).toBeLessThanOrEqual(64); // Telegram callback_data sınırı
    expect(parsePaidData(d)).toEqual({ ruleId: "ae8d3ff5-1413-4d63-8d17-b1b89e48b39b", due: "2026-12-02" });
    expect(parsePaidData("x")).toBeNull();
  });
});
