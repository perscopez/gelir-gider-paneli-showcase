import { describe, expect, it } from "vitest";
import { htmlToText, parseBankEmail as parse, trNumber, type ParsedEmail } from "@/lib/email-parse";

const parseBankEmail = (e: Parameters<typeof parse>[0]) => parse(e) as ParsedEmail | null;

const anka = (rows: string, text = "Hesabınıza FAST Anlık Ödeme gelmiştir.") => `<html><body><table><tr><td>Sayın AL** DE**</td></tr><tr><td>${text}</td></tr>
<tr><td><table>${rows}</table></td></tr></table></body></html>`;
const row = (k: string, v: string) => `<tr><td>${k}</td><td align="right">: </td><td>${v}</td></tr>`;
const base = [row("İşlem Tarihi", "15.11.2026 00:46:44"), row("Hesap Numarası", "*************0001"), row("Gönderen Banka", "Demo Katılım Bankası A.Ş."),
  row("Gönderen Adı Soyadı", "SA* EX*****"), row("Sorgu Numarası", "1000000001"), row("İşlem Tutarı", "2.000 TL"), row("Güncel Bakiye", "3.000,00 TL")].join("");

describe("trNumber", () => {
  it.each([["5.000 TL", 5000], ["7.481,16 TL", 7481.16], ["12,5 TL", 12.5], ["99", 99]])("%s", (s, n) => expect(trNumber(s)).toBe(n));
  it("sayı yoksa null", () => expect(trNumber("TL")).toBeNull());
});

describe("htmlToText", () => {
  it("etiketleri ve stilleri atar, 'etiket : değer' satırlarını korur", () => {
    const t = htmlToText(anka(row("İşlem Tutarı", "2.000 TL")));
    expect(t).toMatch(/İşlem Tutarı\s*:\s*2\.000 TL/);
    expect(t).not.toContain("<");
  });
});

describe("parseBankEmail (Anka Bank)", () => {
  const mail = { from: "Anka Bank <bildirim@ankabank.example>", subject: "ANKA BANK - FAST Anlık Ödeme Bilgilendirmesi", body: anka(base), messageId: "m1" };
  it("gelen FAST ödemesi gelir olarak okunur", () => {
    expect(parseBankEmail(mail)).toMatchObject({
      bank: "anka", kind: "income", amount: 2000, currency: "TRY", occurredOn: "2026-11-15", balanceAfter: 3000,
      accountLast4: "0001", externalId: "mail:anka:1000000001",
    });
  });
  it("gönderen bilgisi açıklamada", () => expect(parseBankEmail(mail)?.merchant).toMatch(/FAST.*SA\*.*Demo Katılım/));
  it("sorgu numarası yoksa mesaj kimliğine düşer", () => {
    const noQuery = { ...mail, body: anka(base.replace(row("Sorgu Numarası", "1000000001"), "")) };
    expect(parseBankEmail(noQuery)?.externalId).toBe("mail:anka:m1");
  });
  it("'gelmiştir' içermeyen e-posta (reklam/ekstre) yok sayılır", () => {
    expect(parseBankEmail({ ...mail, body: anka(base, "Kampanya fırsatı!"), subject: "ANKA BANK kampanya" })).toBeNull();
  });
  it("başka bankadan gelen e-posta tanınmaz", () => expect(parseBankEmail({ from: "x@y.com", subject: "hi", body: "hello" })).toBeNull());
  it("tutar okunamazsa null", () => expect(parseBankEmail({ ...mail, body: anka(row("İşlem Tarihi", "15.11.2026")) })).toBeNull());
});

import { bankName } from "@/lib/email-parse";
describe("bankName", () => {
  it("bilinen banka haritadan, bilinmeyen baş harfi büyük", () => {
    expect(bankName("anka")).toBe("Anka Bank");
    expect(bankName("ingdiba")).toBe("Ingdiba");
  });
});


// ── Sentetik e-posta gövdeleri (biçim örneği; ad, numara ve tutarlar uydurma) ──
const wrap = (inner: string) => `<html><body><table><tr><td>Sayın AL** DE**</td></tr><tr><td>${inner}</td></tr><tr><td>Saygılarımızla,<br>Anka Bank</td></tr></table></body></html>`;
const ankaFrom = "Anka Bank <bildirim@ankabank.example>";

describe("giden FAST", () => {
  const body = wrap("<table align=\"center\">\r\nBankamızdan gönderdiğiniz FAST Anlık Ödeme işleminiz başarı ile gerçekleştirilmiştir.\r\n<br>\r\n<tr><td><table>" +
    row("İşlem Tarihi", "08.10.2026 21:25:02") + row("Hesap Numarası", "*************0001") + row("Alıcı Banka", "Lale Bank A.Ş.") + row("Alıcı Adı Soyadı", "JO** DO*") +
    row("Sorgu Numarası", "1000000002") + row("İşlem Tutarı", "150 TL") + row("Güncel Bakiye", "850,00 TL") + "</table></td></tr></table>");
  it("gider olarak okunur", () => {
    expect(parseBankEmail({ from: ankaFrom, subject: "ANKA BANK - FAST Anlık Ödeme Bilgilendirmesi", body })).toMatchObject({
      type: "txn", kind: "expense", amount: 150, currency: "TRY", occurredOn: "2026-10-08", balanceAfter: 850, externalId: "mail:anka:1000000002",
    });
  });
  it("alıcı bilgisi açıklamada, gelen FAST ile karışmaz", () => {
    const r = parseBankEmail({ from: ankaFrom, subject: "ANKA BANK - FAST", body });
    expect(r?.merchant).toMatch(/FAST.*JO\*+.*Lale Bank/);
    expect(r?.kind).toBe("expense");
  });
});

describe("debit kartıyla alışveriş", () => {
  const body = wrap(`<table width="500">
<tr><td> <strong>Hesap Numarası</strong>  </td><td>****0001</td><td width="100"></td></tr>
<tr><td> <strong>İşlem Tarihi</strong>  </td><td> 18.07.2026</td><td width="100"></td></tr>
<tr><td> <strong>İşyeri Adı</strong>  </td><td> DEMO/Muzik Market    ISTANBUL        TRTR</td><td width="100"></td></tr>
<tr><td> <strong>İşlem Tutarı</strong> </td><td> 400,00 TL</td><td width="100"></td></tr></table>`).replace("Sayın", "****1111 nolu Debit kartınız ile gerçekleşen alışveriş detayları aşağıda yer almaktadır. Sayın");
  const mail = { from: ankaFrom, subject: "Bilgilendirme: Mevduat Hesabı Para Çıkışları", body, messageId: "abc123" };
  it("gider, işyeri adı sadeleşir (ülke kodu atılır), tutar ve tarih doğru", () => {
    expect(parseBankEmail(mail)).toMatchObject({ type: "txn", kind: "expense", amount: 400, currency: "TRY", occurredOn: "2026-07-18", merchant: "DEMO/Muzik Market ISTANBUL", externalId: "mail:anka:card:abc123" });
  });
  it("e-posta kimliği yoksa tarih+tutar+işyeri ile tekilleşir", () => expect(parseBankEmail({ ...mail, messageId: undefined })?.externalId).toBe("mail:anka:card:18.07.2026:400:DEMO/Muzik Market ISTANBUL"));
});

describe("kredi kartı hatırlatmaları (işlem değil)", () => {
  const reminder = (head: string, subject: string, fmtB: 1 | 2) => {
    const k = (l: string, v: string) => fmtB === 1 ? `<tr><td><strong>${l} :</strong></td><td> ${v} </td></tr>` : `<tr><td><strong>${l}</strong></td><td><strong>:</strong> ${v} </td></tr>`;
    return { from: ankaFrom, subject, body: wrap(`${head}<table>${k("Kart Numarası", "5555********1234")}${k("Ekstre Borç Bakiyesi", "1.250,00 TL")}${k("Asgari Ödeme Tutari", "375,00 TL")}${k("Son Ödeme Tarihi", "11.05.2026")}</table>`) };
  };
  it("son ödeme günü (1. biçim)", () => {
    const r = parse(reminder("Kredi kartınızın son ödeme tarihi bugündür. Ödemenizi gerçekleştirdiyseniz bu mesajı dikkate almayınız.", "Bilgilendirme: Kredi Kartı Son Ödeme Tarihi", 1));
    expect(r).toMatchObject({ type: "reminder" });
    expect((r as { title: string; text: string }).title).toMatch(/son ödeme günü/i);
    expect((r as unknown as { text: string }).text).toMatch(/1\.250,00[\s\S]*375[\s\S]*11\.05\.2026/);
  });
  it("asgari ödenmemiş (2. biçim)", () => {
    const r = parse(reminder("Kredi kartı borcunuzun asgarisi ödenmemiştir. Ödemenizi gerçekleştirdiyseniz bu maili dikkate almayınız.", "Bilgilendirme: Kredi Kartı Asgari Ödeme Tutarı", 2));
    expect(r).toMatchObject({ type: "reminder" });
    expect((r as { title: string }).title).toMatch(/asgari/i);
  });
});

describe("kredi kartı hesap özeti e-postası (1,150.00 biçimi)", () => {
  const body = `<html><body><div>5555********1234 numaralı Anka Bank Kredi Kartı Hesap Ozetiniz ekte bilgilerinize sunulmustur.</div>
<div>Toplam Borç Bakiyesi    :1,150.00TL</div><div>Asgari Ödeme Tutarı      :345.00TL</div><div>Son Ödeme Tarihi          :09.11.2026</div></body></html>`;
  it("borç, asgari ve son ödeme tarihi okunur; Türkçe biçimde yazılır", () => {
    const r = parse({ from: "ANKA BANK <statements@ankabank.example>", subject: "Anka Bank Kredi Kartı Hesap Özetiniz", body });
    expect(r).toMatchObject({ type: "reminder" });
    const t = (r as unknown as { text: string }).text;
    expect(t).toContain("1.150,00");
    expect(t).toContain("345,00");
    expect(t).toContain("09.11.2026");
  });
});

describe("kırılmaz boşluklu (NBSP) kart özeti e-postası", () => {
  it("Apps Script gövdesindeki U+00A0 karakterlerine rağmen borç ve son ödeme okunur", () => {
    const nb = " ";
    const body = `<html><body><div>Toplam Borç Bakiyesi${nb}${nb}:1,150.00TL</div><div>Asgari Ödeme Tutarı${nb}${nb}:345.00TL</div><div>Son Ödeme Tarihi${nb}${nb}:09.11.2026</div></body></html>`;
    const r = parseBankEmail({ from: "ANKA BANK <statements@ankabank.example>", subject: "Anka Bank Kredi Kartı Hesap Özetiniz", body });
    expect(r).toMatchObject({ type: "reminder" });
    expect((r as unknown as { text: string }).text).toContain("1.150,00");
    expect((r as unknown as { text: string }).text).toContain("09.11.2026");
  });
});
