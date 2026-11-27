import type { ParsedStatement } from "./contoso";

// Ekstre türü hesap türüyle uyuşmalı: kredi kartı ekstresi kredi kartı hesabına, diğerleri kredi kartı olmayan hesaba; para birimi aynı olmalı.
export function checkStatementAccount(st: Pick<ParsedStatement, "bank" | "currency">, account: { currency: string; type: string }) {
  if (account.currency !== st.currency) throw new Error(`Ekstre ${st.currency}, seçtiğin hesap ${account.currency}. Aynı para birimindeki hesabı seç.`);
  if ((st.bank === "anka-card" || st.bank === "lale-card") && account.type !== "credit_card") throw new Error("Bu bir kredi kartı ekstresi: kredi kartı türünde bir hesap seç (yoksa önce Hesaplar'dan ekle).");
  if (st.bank !== "anka-card" && st.bank !== "lale-card" && account.type === "credit_card") throw new Error("Bu ekstre kredi kartı ekstresi değil; kredi kartı olmayan bir hesap seç.");
}
