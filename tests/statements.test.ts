import { describe, expect, it } from "vitest";
import { detectStatement, parseAnkaDebit, parseAnkaCard } from "@/lib/statements/anka";

// Sentetik ekstre metinleri: yalnızca biçim örneği. Tüm adlar, numaralar ve tutarlar uydurmadır.
const card = `Kredi Kartı Hesap Özeti (TL)
HESAP BİLGİLERİNİZ
Dönem Borcunuz : 1,150.00 TL
Asgari Ödeme Tutarı : 345.00 TL
Son Ödeme Tarihi : 09.11.2026
Kart No : 5555********1234
Limitiniz : 5,000.00 TL
Hesap Kesim Tarihi : 30.10.2026
İŞLEM TARİHİ AÇIKLAMA TUTAR (TL) KALAN TAKSİT PUAN
02.10.2026 ÖNCEKİ DÖNEM HESAP ÖZETİ BAKİYENİZ 800.00
02.10.2026 10.00 EUR DEMO CLOUD HOSTING/EXAMPLE 400.00
03.10.2026 ÖDEMENİZ İÇİN TEŞEKKÜRLER +800.00
16.10.2026 DEMO SOFTWARE/EXAMPLE.COM 300.00
19.10.2026 DEMO SHOP 50.00 2
23.10.2026 DEMO GAMES 1/EXAMPLE.COM 200.00
25.10.2026 5.00 EUR Demo Cloud/example.com 200.00
HESAP ÖZETİ
Önceki Hesap Bakiyesi 800.00
Dönem Içi Islemler 1,150.00
Toplam Faiz ve Ücretler 0.00
Ödemeler +800.00
Dönem Borcunuz 1,150.00`;

const debit = `DEBIT PARA
EKSTRESİ
Hesap Bilgileriniz
Dönem : Ekim-2026
Hesap No : 0000********0001
Toplam Alışveriş Tutarı : 250,00 (TL)
****1111 numaralı karta ait işlemler
İşlem Tarihi Açıklama Tutar (TL) Debit Para (TL)
16.10.2026 DEMO CICEKCI 250,00 0,01
Debit Para Bilgileriniz`;

describe("detectStatement", () => {
  it("biçimi tanır", () => {
    expect(detectStatement([card])).toBe("anka-card");
    expect(detectStatement([debit])).toBe("anka-debit");
    expect(detectStatement(["Contoso Bank\nTransaction date Description"])).toBe("contoso");
    expect(detectStatement(["başka bir belge"])).toBeNull();
  });
});

describe("parseAnkaCard", () => {
  const st = parseAnkaCard([card]);
  it("başlık bilgileri", () => {
    expect(st).toMatchObject({ bank: "anka-card", currency: "TRY", startingBalance: -800, finalBalance: -1150, periodTo: "2026-10-30" });
    expect(st.card).toEqual({ last4: "1234", limit: 5000, cutoff: "2026-10-30", dueDate: "2026-11-09", minPayment: 345, debt: 1150 });
  });
  it("6 işlem: devir satırı atılır, harcamalar negatif, ödeme pozitif", () => {
    expect(st.rows).toHaveLength(6);
    expect(st.rows.filter((r) => r.kind === "card").map((r) => r.amount)).toEqual([-400, -300, -50, -200, -200]);
    expect(st.rows.find((r) => r.kind === "card_payment")).toMatchObject({ amount: 800, date: "2026-10-03" });
  });
  it("dövizli harcama: tutar TL, orijinal tutar not", () => {
    const h = st.rows.find((r) => r.merchant.startsWith("DEMO CLOUD HOSTING"));
    expect(h).toMatchObject({ amount: -400, merchant: "DEMO CLOUD HOSTING/EXAMPLE", note: "Orijinal tutar: 10.00 EUR" });
  });
  it("taksitli satır: 'kalan taksit' sayısı tutar sanılmaz", () => expect(st.rows.find((r) => r.merchant === "DEMO SHOP")?.amount).toBe(-50));
  it("kimlikler benzersiz ve kararlı", () => {
    const ids = st.rows.map((r) => r.externalId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseAnkaCard([card]).rows.map((r) => r.externalId)).toEqual(ids);
  });
  it("özetle tutmayan ekstre reddedilir", () => {
    expect(() => parseAnkaCard([card.replace("Dönem Içi Islemler 1,150.00", "Dönem Içi Islemler 1,100.00")])).toThrow(/doğrulanamadı/);
    expect(() => parseAnkaCard([card.replace("Ödemeler +800.00", "Ödemeler +500.00")])).toThrow(/Ödemeler tutmuyor/);
  });
  it("aynı gün aynı tutar iki harcama ayrışır (kimlik sonuna sıra no)", () => {
    const dup = card.replace("19.10.2026 DEMO SHOP 50.00 2", "19.10.2026 DEMO SHOP 50.00 2\n19.10.2026 DEMO SHOP 50.00 2").replace("Dönem Içi Islemler 1,150.00", "Dönem Içi Islemler 1,200.00").replace("Dönem Borcunuz 1,150.00", "Dönem Borcunuz 1,200.00");
    const r = parseAnkaCard([dup.replace("Dönem Borcunuz : 1,150.00 TL", "Dönem Borcunuz : 1,200.00 TL")]);
    const t = r.rows.filter((x) => x.merchant === "DEMO SHOP");
    expect(t).toHaveLength(2);
    expect(t[0].externalId).not.toBe(t[1].externalId);
  });
});

describe("parseAnkaDebit", () => {
  it("harcamalar giderdir, toplam doğrulanır, bakiye bilinmez", () => {
    const st = parseAnkaDebit([debit]);
    expect(st).toMatchObject({ bank: "anka-debit", balanceKnown: false, currency: "TRY" });
    expect(st.rows).toHaveLength(1);
    expect(st.rows[0]).toMatchObject({ date: "2026-10-16", amount: -250, merchant: "DEMO CICEKCI" });
  });
  it("toplam tutmazsa reddeder", () => expect(() => parseAnkaDebit([debit.replace("250,00 (TL)", "300,00 (TL)")])).toThrow(/tutmuyor/));
});

import { checkStatementAccount } from "@/lib/statements/check";
describe("checkStatementAccount", () => {
  const card = { bank: "anka-card" as const, currency: "TRY" };
  it("kredi kartı ekstresi yalnızca kredi kartı hesabına", () => {
    expect(() => checkStatementAccount(card, { currency: "TRY", type: "credit_card" })).not.toThrow();
    expect(() => checkStatementAccount(card, { currency: "TRY", type: "bank" })).toThrow(/kredi kartı türünde/);
  });
  it("banka ekstresi kredi kartı hesabına yazılamaz", () => {
    expect(() => checkStatementAccount({ bank: "anka-debit", currency: "TRY" }, { currency: "TRY", type: "credit_card" })).toThrow(/kredi kartı olmayan/);
    expect(() => checkStatementAccount({ bank: "anka-debit", currency: "TRY" }, { currency: "TRY", type: "bank" })).not.toThrow();
  });
  it("para birimi uyuşmazsa hata", () => expect(() => checkStatementAccount({ bank: "contoso", currency: "EUR" }, { currency: "TRY", type: "bank" })).toThrow(/EUR/));
});

import { findCardAccount, findAnkaBank, planRows } from "@/lib/statements/auto-import";
import type { StatementRow } from "@/lib/statements/contoso";

const acc = (o: Record<string, unknown>) => ({ id: "x", name: "", institution: null, currency: "TRY", type: "bank", ...o }) as never;
describe("hesap eşleme (otomatik içe aktarma)", () => {
  it("Anka Bank TL hesabı: ad ya da kurumdan, TRY ve banka türü", () => {
    expect(findAnkaBank([acc({ id: "a", name: "Lale Bank" }), acc({ id: "b", name: "Anka Bank" })])?.id).toBe("b");
    expect(findAnkaBank([acc({ id: "c", name: "Maaş", institution: "Anka Bank" })])?.id).toBe("c");
    expect(findAnkaBank([acc({ id: "d", name: "Anka Bank", currency: "EUR" })])).toBeNull();
    expect(findAnkaBank([acc({ id: "e", name: "Anka Bank Kart", type: "credit_card" })])).toBeNull();
  });
  it("kredi kartı: son 4 hane önce; tek yedek yalnızca Anka Bank kartı; başka bankanın kartına yazılmaz", () => {
    const a = acc({ id: "1", name: "Anka Bank Kredi Kartı ····1234", type: "credit_card" });
    const b = acc({ id: "2", name: "Lale Bank Kart", type: "credit_card" });
    expect(findCardAccount([a, b], "1234")?.id).toBe("1");
    expect(findCardAccount([b], "1234")).toBeNull();
    expect(findCardAccount([acc({ id: "3", name: "Gold", institution: "Anka Bank", type: "credit_card" })], "9999")?.id).toBe("3");
    expect(findCardAccount([a, acc({ id: "4", name: "Anka Platinum", type: "credit_card" })], "0000")).toBeNull(); // iki aday: belirsiz
  });
});

describe("planRows: tekilleştirme ve uzlaştırma", () => {
  const row = (date: string, amount: number, id: string) => ({ date, amount, externalId: id, merchant: "X", note: null, kind: "card" }) as StatementRow;
  const ex = (id: string, date: string, amount: number, external: string | null = null) => ({ id, occurred_on: date, amount, kind: "expense", external_id: external, source: "email" });
  const any = () => true;
  it("aynı kimlik = zaten var; eşleşen mevcut kayıt = uzlaştır (bağla); diğerleri yeni", () => {
    const p = planRows([row("2026-10-02", -100, "a"), row("2026-10-05", -50, "b"), row("2026-10-09", -70, "c")], [ex("e1", "2026-10-04", 50)], new Set(["a"]), any);
    expect(p.duplicates.map((r) => r.externalId)).toEqual(["a"]);
    expect(p.reconciled).toEqual([{ row: expect.objectContaining({ externalId: "b" }), existingId: "e1", link: true, settle: false }]);
    expect(p.fresh.map((r) => r.externalId)).toEqual(["c"]);
  });
  it("her mevcut kayıt yalnızca bir satırla eşleşir (iki aynı tutar → biri yeni)", () => {
    const p = planRows([row("2026-10-02", -12.5, "a"), row("2026-10-03", -12.5, "b")], [ex("e1", "2026-10-02", 12.5)], new Set(), any);
    expect(p.reconciled).toHaveLength(1);
    expect(p.fresh).toHaveLength(1);
  });
  it("kimliği olan mevcut kayıt bağlanmaz (link=false); 3 günden uzak eşleşmez", () => {
    expect(planRows([row("2026-10-02", -10, "a")], [ex("e1", "2026-10-02", 10, "mail:1")], new Set(), any).reconciled[0].link).toBe(false);
    expect(planRows([row("2026-10-02", -10, "a")], [ex("e1", "2026-10-09", 10)], new Set(), any).fresh).toHaveLength(1);
  });
});

import { parseLaleCard } from "@/lib/statements/lale";
describe("Lale Bank kredi kartı", () => {
  const pages = [`Kredi Kartı Hesap Ekstresi
Kredi Kartı Numarası 5555********4321
İşlem Tarihi Hesap Ekstresi
Detayı
İşlem Tutarı Kalan Taksit
Tutarı ve Sayısı
Puanlama
24/09/2026 DEMO ONLINE ODEME. 15 0-0 0
24/09/2026 DEMO ONLINE ODEME. 15 0-0 0
25/09/2026 DEMO MARKET 120.50 0-0 0
16/10/2026 DEMO KAFE 45 0-0 180.50`];
  it("tanır ve satırları okur", () => {
    expect(detectStatement(pages)).toBe("lale-card");
    const st = parseLaleCard(pages);
    expect(st.ibanLast4).toBe("4321");
    expect(st.rows.map((r) => r.amount)).toEqual([-15, -15, -120.5, -45]);
    expect(new Set(st.rows.map((r) => r.externalId)).size).toBe(4); // aynı gün aynı tutar ayrı kayıt
    expect(st.rows[0].date).toBe("2026-09-24");
  });
  it("okunamayan satırda hata verir", () => {
    expect(() => parseLaleCard([pages[0] + "\n17/10/2026 BOZUK SATIR"])).toThrow();
  });
});

describe("planRows: tekrarlayan yer tutucu", () => {
  const row = (amount: number, date: string) => ({ date, amount, balanceAfter: 0, merchant: "DEMO SUBSCRIPTION", note: null, kind: "card" as const, opType: "", cardLast4: null, counterparty: null, externalId: "vk:x" });
  it("tekrarlayan kayıt tutar/tarih farklı olsa da eşleşir ve düzeltilir", () => {
    const p = planRows([row(-105, "2026-11-24")], [{ id: "r1", occurred_on: "2026-11-23", amount: 100, kind: "expense", external_id: "rec:1", source: "recurring" }], new Set(), () => true);
    expect(p.fresh).toHaveLength(0);
    expect(p.reconciled[0]).toMatchObject({ existingId: "r1", settle: true });
  });
  it("elle girilmiş kayıt farklı tutarda eşleşmez", () => {
    const p = planRows([row(-105, "2026-11-24")], [{ id: "m1", occurred_on: "2026-11-23", amount: 100, kind: "expense", external_id: null, source: "manual" }], new Set(), () => true);
    expect(p.fresh).toHaveLength(1);
  });
});

import { parseAnkaAccount } from "@/lib/statements/anka-account";
describe("Anka Bank hesap hareketleri", () => {
  const pages = [`Hesap Hareketleri
Hesap No: 00000000000000001234
Müş. No : 1 Bakiye : 3.000,00 TL
Hesap Türü : VADESİZ TL Rumuz :
Tarih Aralığı : 15.10.2026 - 15.11.2026
TARİH SAAT İŞLEM NO MİKTAR BAKİYE İŞLEM ADI
16.10.2026 12:21 1000000000000001 -250,00 2.150,00 Diğer Banka POS-Alışveriş
Referans :1 Term Id :00000000- ISLEM NO : -DEMO CICEKCI ISTANBUL TR**** SAAT :12:21:28
02.11.2026 22:21 1000000000000002 -1.150,00 1.000,00 Kredi Kartı Borç Öde
5555********1234 no'lu Kredi Kartı Borç Ödemesi
15.11.2026 00:46 1000000000000003 2.000,00 3.000,00 Gelen FAST Anlık Ödeme
GİDEN FAST - AD SOYAD TARAFINDAN GÖNDERİLEN (x)`];
  it("tanır, satırları ve kart ödemesini okur, bakiye zincirini doğrular", () => {
    expect(detectStatement(pages)).toBe("anka-account");
    const st = parseAnkaAccount(pages);
    expect(st.startingBalance).toBe(2400);
    expect(st.rows.map((r) => r.amount)).toEqual([-250, -1150, 2000]);
    expect(st.rows[0].merchant).toBe("DEMO CICEKCI ISTANBUL");
    expect(st.rows[1]).toMatchObject({ kind: "card_payment", cardLast4: "1234", externalId: "vh:1000000000000002" });
  });
  it("bakiye zinciri bozuksa hata verir", () => {
    expect(() => parseAnkaAccount([pages[0].replace("1.000,00 Kredi", "900,00 Kredi")])).toThrow(/doğrulanamadı/);
  });
});
