import { z } from "zod";
import { UserFacingError } from "@/lib/errors";
import { brandsForPrompt } from "@/lib/store-brands";
import { GROCERY_CATEGORIES, type GroceryCategory, type ReceiptItem } from "@/lib/grocery";

// Fiş/fatura görselini (veya PDF'ini) Gemini ya da Groq ile okur (RECEIPT_PROVIDER ile seçilir).
export type Receipt = {
  merchant: string;
  date: string | null; // YYYY-MM-DD
  total: number;
  currency: "EUR" | "TRY" | null;
  category: string | null;
  summary: string | null;
  isGrocery: boolean;
  items: ReceiptItem[];
  provider: "gemini" | "groq";
  itemsDiff: number | null; // fiş toplamı - kalemler toplamı (kalem varsa)
};

export class ReceiptError extends UserFacingError {}

const Out = z.object({
  is_receipt: z.boolean(),
  merchant: z.string().nullable().optional(),
  date: z.string().nullable().optional(),
  total: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  is_grocery: z.boolean().nullable().optional(),
  items: z
    .array(
      z.object({
        name: z.string().nullable().optional(),
        product: z.string().nullable().optional(),
        brand: z.string().nullable().optional(),
        quantity: z.number().nullable().optional(),
        unit: z.string().nullable().optional(),
        pack_amount: z.number().nullable().optional(),
        pack_unit: z.string().nullable().optional(),
        unit_price: z.number().nullable().optional(),
        line_total: z.number().nullable().optional(),
        category: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});

const SCHEMA = {
  type: "OBJECT",
  properties: {
    is_receipt: { type: "BOOLEAN" },
    merchant: { type: "STRING", nullable: true },
    date: { type: "STRING", nullable: true },
    total: { type: "NUMBER", nullable: true },
    currency: { type: "STRING", nullable: true },
    category: { type: "STRING", nullable: true },
    summary: { type: "STRING", nullable: true },
    is_grocery: { type: "BOOLEAN", nullable: true },
    items: {
      type: "ARRAY",
      nullable: true,
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          product: { type: "STRING", nullable: true },
          brand: { type: "STRING", nullable: true },
          quantity: { type: "NUMBER", nullable: true },
          unit: { type: "STRING", nullable: true },
          pack_amount: { type: "NUMBER", nullable: true },
          pack_unit: { type: "STRING", nullable: true },
          unit_price: { type: "NUMBER", nullable: true },
          line_total: { type: "NUMBER" },
          category: { type: "STRING", enum: [...GROCERY_CATEGORIES] },
        },
        required: ["name", "line_total", "category"],
      },
    },
  },
  required: ["is_receipt"],
};

export const RECEIPT_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];

function buildPrompt(categories: string[]) {
  return [
    "You read purchase receipts (German, Turkish or English) and return JSON.",
    "- is_receipt: false if the image is not a receipt/invoice/payment slip.",
    "- merchant: the store or company name (short, as printed, e.g. REWE, Lidl, Migros).",
    "- date: purchase date as YYYY-MM-DD. German dates are DD.MM.YYYY. null if not readable.",
    "- total: the final amount actually paid (Summe / Gesamt / Zu zahlen / TOPLAM / Toplam), after discounts, including tax, as a positive number with a dot decimal. Not a subtotal, not the change/Rückgeld, not the card slip tip.",
    "- currency: EUR or TRY (Germany -> EUR, Turkey -> TRY). null if unknown.",
    `- category: the best fit from this list, or null: ${categories.join(", ") || "(none)"}.`,
    "- summary: at most 60 characters, what was bought (e.g. 'Groceries, 12 items').",
    "- is_grocery: true for supermarket, discounter, bakery, drugstore, kiosk or any other purchase that lists individual product lines.",
    "- items: ALWAYS fill this when the receipt lists individual product lines (even if you are unsure it is a grocery store); empty array only for single-amount slips such as restaurant card slips or fuel pumps. One entry per product line, in receipt order:",
    "  name = as printed; product = generic product name without brand or pack size in the receipt's language (e.g. 'Vollmilch', 'Spaghetti', 'Aepfel'); brand = brand if recognizable else null;",
    "  quantity = number of pieces (for weighed goods the weight in kg, unit 'kg'; otherwise unit 'pcs'); pack_amount + pack_unit = pack size printed in the name (e.g. 1 and 'l', 500 and 'g') else null;",
    "  unit_price = price per piece or per kg as printed; line_total = what that line cost (negative for discounts/coupons: Rabatt, Coupon, Preisvorteil, Aktionspreis-Abzug).",
    "  category must be one of: " + GROCERY_CATEGORIES.join(" | ") + ". Deposit lines (Pfand) -> 'Depozito (Pfand)'; discount lines -> 'İndirim'.",
    "  Do not list totals, tax (MwSt) summary, payment or change lines.",
    "- Receipts use heavy abbreviations (e.g. VOLLM = Vollmilch, HAEHNCHENBR = Hähnchenbrust, BIO, TK = tiefgekühlt, Ktf = Kartoffeln). Expand them in `product` to the real everyday product name in German.",
    "- Many lines carry only a store private label or none. Known private labels by store: " + brandsForPrompt() + ". If the line shows one, set `brand`; if the store is clearly identified and the product obviously belongs to one of its labels (e.g. Lidl yoghurt line without brand), you may set that label, otherwise leave brand null. Never invent a brand.",
  ].join("\n");

}

type ReadInput = { bytes: Uint8Array; mime: string; categories: string[] };

// ── Gemini (ücretsiz katman): GEMINI_API_KEY ──
async function viaGemini(input: ReadInput, prompt: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY!;
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";
  const base = process.env.GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com";
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: input.mime, data: Buffer.from(input.bytes).toString("base64") } }] }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0, maxOutputTokens: 8192 },
  });

  // Geçici hatalarda (503 "model aşırı yüklü", 500/502/504) kısa beklemeyle yeniden dene; 429 kotası ya da hâlâ 503 ise yedek modele geç.
  // İlk model geçersizse (400/403) hemen bırak: anahtar/model adı yanlış.
  const models = [model, ...(process.env.GEMINI_FALLBACK_MODELS ?? "gemini-flash-lite-latest").split(",").map((m) => m.trim()).filter(Boolean)].filter((m, i, a) => a.indexOf(m) === i);
  const retryMs = Number(process.env.GEMINI_RETRY_MS ?? 1500);
  const started = Date.now();
  const statuses: number[] = [];
  let res: Response | null = null;
  outer: for (const [mi, m] of models.entries()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() - started > 40_000) break outer; // Vercel süre sınırı (60 sn) için pay bırak
      let r: Response;
      try {
        r = await fetch(`${base}/v1beta/models/${m}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": key },
          body,
          signal: AbortSignal.timeout(20_000),
        });
      } catch {
        statuses.push(0);
        await new Promise((ok) => setTimeout(ok, retryMs));
        continue;
      }
      if (r.ok) { res = r; break outer; }
      statuses.push(r.status);
      if ((r.status === 400 || r.status === 403) && mi === 0) throw new ReceiptError("Fiş okuma anahtarı veya modeli geçersiz (GEMINI_API_KEY / GEMINI_MODEL kontrol et).");
      if (r.status === 429 || r.status === 400 || r.status === 403 || r.status === 404) continue outer; // bu modelde kota/geçersiz: sıradaki modele geç
      await new Promise((ok) => setTimeout(ok, retryMs * (attempt + 1))); // 5xx: biraz bekle, tekrar dene
    }
  }
  if (!res) {
    if (statuses.length && statuses.every((c) => c === 429)) throw new ReceiptError("Ücretsiz fiş okuma kotası doldu. Daha sonra tekrar dene ya da tutarı elle yaz (örn. 23,45 market).");
    if (statuses.some((c) => c >= 500 || c === 0)) throw new ReceiptError("Fiş okuma servisi (Google) şu an yoğun, birkaç dakika sonra aynı fotoğrafı tekrar gönder. Acil ise tutarı elle yaz (örn. 23,45 market).");
    throw new ReceiptError(`Fiş okuma servisi hata verdi (${statuses.at(-1) ?? "?"}).`);
  }

  const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; promptFeedback?: { blockReason?: string } };
  const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("").trim();
  if (!text) throw new ReceiptError(json.promptFeedback?.blockReason ? "Görsel okuma tarafından engellendi." : "Fiş okunamadı (boş yanıt).");
  return text;
}

// ── Groq (OpenAI uyumlu, görsel destekli model): GROQ_API_KEY. PDF desteklemez, yalnızca görsel. ──
// Llama 4 Scout 17.07.2026'da kapandı; Groq'un güncel görsel modeli Qwen 3.8 27B.
export const GROQ_DEFAULT_MODEL = "qwen/qwen3.8-27b";

const JSON_SHAPE = `Return ONLY a JSON object of this shape: {"is_receipt":bool,"merchant":str|null,"date":"YYYY-MM-DD"|null,"total":number|null,"currency":"EUR"|"TRY"|null,"category":str|null,"summary":str|null,"is_grocery":bool,"items":[{"name":str,"product":str|null,"brand":str|null,"quantity":number,"unit":str|null,"pack_amount":number|null,"pack_unit":str|null,"unit_price":number|null,"line_total":number,"category":str}]}`;

async function viaGroq(input: ReadInput, prompt: string): Promise<string> {
  const key = process.env.GROQ_API_KEY!;
  if (input.mime === "application/pdf") throw new ReceiptError("Groq PDF okuyamaz; fotoğraf gönder ya da GEMINI_API_KEY ekle.");
  if (input.bytes.length > 3_000_000) throw new ReceiptError("Fotoğraf Groq için çok büyük (3 MB üstü). Daha küçük çekip tekrar gönder.");
  const model = process.env.GROQ_MODEL ?? GROQ_DEFAULT_MODEL;
  const base = process.env.GROQ_API_BASE ?? "https://api.groq.com";
  const dataUrl = `data:${input.mime};base64,${Buffer.from(input.bytes).toString("base64")}`;
  let res: Response | null = null;
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${base}/openai/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0, max_completion_tokens: 8192, response_format: { type: "json_object" },
          ...(/qwen3\.8/.test(model) ? { reasoning_effort: "none" } : {}), // düşünme kapalı: hızlı ve yalnızca JSON döner
          messages: [{ role: "user", content: [{ type: "text", text: `${prompt}\n${JSON_SHAPE}` }, { type: "image_url", image_url: { url: dataUrl } }] }],
        }),
        signal: AbortSignal.timeout(25_000),
      });
      if (r.ok) { res = r; break; }
      statuses.push(r.status);
      if (r.status === 401 || r.status === 403) throw new ReceiptError("Groq anahtarı geçersiz (GROQ_API_KEY kontrol et).");
      if (r.status === 400 || r.status === 404) {
        const detail = ((await r.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message?.slice(0, 160) ?? "";
        throw new ReceiptError(`Groq isteği reddetti (${r.status}, model: ${model}). ${detail}`.trim());
      }
      if (r.status === 429) break;
    } catch (e) {
      if (e instanceof ReceiptError) throw e;
      statuses.push(0);
    }
    await new Promise((ok) => setTimeout(ok, Number(process.env.GEMINI_RETRY_MS ?? 1500)));
  }
  if (!res) {
    if (statuses.every((c) => c === 429)) throw new ReceiptError("Groq kotası doldu. Biraz sonra tekrar dene ya da tutarı elle yaz (örn. 23,45 market).");
    throw new ReceiptError(`Groq fiş okuma servisi şu an yanıt vermiyor (${statuses.at(-1) ?? "?"}), tekrar dene.`);
  }
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content?.trim();
  if (!text) throw new ReceiptError("Fiş okunamadı (boş yanıt).");
  return text;
}

// Hangi sağlayıcılar kullanılabilir: RECEIPT_PROVIDER = auto (varsayılan: Gemini, olmazsa/başarısızsa Groq) | gemini | groq
export function receiptProviders(): ("gemini" | "groq")[] {
  const pref = (process.env.RECEIPT_PROVIDER ?? "auto").toLowerCase();
  const order: ("gemini" | "groq")[] = pref === "groq" ? ["groq", "gemini"] : ["gemini", "groq"];
  const has = { gemini: !!process.env.GEMINI_API_KEY, groq: !!process.env.GROQ_API_KEY };
  return order.filter((p) => has[p]); // tercih edilen önce; diğeri yedek
}

export async function readReceipt(input: ReadInput): Promise<Receipt> {
  const providers = receiptProviders();
  if (!providers.length) throw new ReceiptError("Fiş okuma kapalı: Vercel'de GEMINI_API_KEY veya GROQ_API_KEY ayarlı değil.");
  const prompt = buildPrompt(input.categories);

  let text = "";
  let used: "gemini" | "groq" = providers[0];
  let lastErr: ReceiptError | null = null;
  for (const p of providers) {
    try {
      text = await (p === "gemini" ? viaGemini(input, prompt) : viaGroq(input, prompt));
      used = p;
      lastErr = null;
      break;
    } catch (e) {
      if (!(e instanceof ReceiptError)) throw e;
      lastErr = e; // bu sağlayıcı olmadı: sıradakini dene
    }
  }
  if (lastErr) throw lastErr;

  let parsed: z.infer<typeof Out>;
  try {
    parsed = Out.parse(JSON.parse(text));
  } catch {
    throw new ReceiptError("Fiş okunamadı (beklenmeyen yanıt).");
  }
  if (!parsed.is_receipt) throw new ReceiptError("Bu bir fişe benzemiyor.");
  if (!(parsed.total && parsed.total > 0 && parsed.total < 1_000_000)) throw new ReceiptError("Fişte toplam tutarı okuyamadım. Tutarı elle yaz (örn. 23,45 market).");

  const cur = (parsed.currency ?? "").toUpperCase();
  const currency = /EUR|€/.test(cur) ? "EUR" : /TRY|TL|₺/.test(cur) ? "TRY" : null;
  const date = parsed.date && /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : null;
  const total = Math.round(parsed.total * 100) / 100;
  const cats = new Set<string>(GROCERY_CATEGORIES);
  const items: ReceiptItem[] = (parsed.items ?? [])
    .filter((i) => i.name && typeof i.line_total === "number" && Number.isFinite(i.line_total))
    .slice(0, 150)
    .map((i) => ({
      name: i.name!.trim().slice(0, 120),
      product: i.product?.trim().slice(0, 80) || null,
      brand: i.brand?.trim().slice(0, 60) || null,
      quantity: i.quantity && i.quantity > 0 ? i.quantity : 1,
      unit: i.unit?.trim().toLowerCase().slice(0, 8) || null,
      packAmount: i.pack_amount && i.pack_amount > 0 ? i.pack_amount : null,
      packUnit: i.pack_unit?.trim().toLowerCase().slice(0, 8) || null,
      unitPrice: typeof i.unit_price === "number" && i.unit_price >= 0 ? i.unit_price : null,
      lineTotal: Math.round(i.line_total! * 100) / 100,
      category: (cats.has(i.category ?? "") ? i.category : "Diğer") as GroceryCategory,
    }));
  const itemsSum = items.reduce((a, i) => a + i.lineTotal, 0);
  return {
    isGrocery: items.length > 0, // model bayrağı yanlış işaretlese de kalem okunduysa kaydet
    items,
    itemsDiff: items.length ? Math.round((total - itemsSum) * 100) / 100 : null,
    provider: used,
    merchant: (parsed.merchant ?? "").trim().slice(0, 80) || "Fiş",
    date, total, currency,
    category: input.categories.includes(parsed.category ?? "") ? parsed.category! : null,
    summary: parsed.summary?.trim().slice(0, 80) || null,
  };
}
