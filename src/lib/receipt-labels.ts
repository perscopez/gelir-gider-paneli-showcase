export type ReceiptLabels = { verdict: { cheap: string; fair: string; expensive: string; avg: string; times: string; cheapest: string }; find: string; noImage: string; wrongMatch: string; match: { high: string; medium: string; low: string; generic: string; picked: string }; storeSearch: string; storeProduct: string; storeFind: string; barcode: string; scan: string; barcodeNone: string; kind: Record<"discount" | "deposit" | "bag" | "other", string> };

export const receiptLabels = (tr: boolean): ReceiptLabels => ({
  verdict: { cheap: tr ? "Ucuz" : "Cheap", fair: tr ? "Normal" : "Fair", expensive: tr ? "Pahalı" : "Pricey", avg: tr ? "Senin ortalaman" : "Your median", times: tr ? "alım" : "buys", cheapest: tr ? "en ucuz" : "cheapest" },
  barcode: tr ? "Barkod (EAN) ile bul" : "Find by barcode (EAN)", scan: tr ? "Kamerayla tara" : "Scan with camera", barcodeNone: tr ? "Bu barkod Open Food Facts'te yok." : "Barcode not in Open Food Facts.",
  storeProduct: tr ? "ürün sayfası" : "product page", storeFind: tr ? "sitesinde ara" : "search on site",
  find: tr ? "Ürünü ara" : "Find product", noImage: tr ? "Fotoğraf yok" : "No photo", wrongMatch: tr ? "Yanlış ürün mü? Doğrusunu seç:" : "Wrong product? Pick the right one:", storeSearch: tr ? "Markette ara" : "Search store",
  kind: { discount: tr ? "İndirim" : "Discount", deposit: tr ? "Depozito" : "Deposit", bag: tr ? "Poşet" : "Bag", other: tr ? "Diğer" : "Other" },
  match: { high: tr ? "Eşleşti" : "Match", medium: tr ? "Olası" : "Likely", low: tr ? "Belirsiz" : "Unsure", generic: tr ? "Örnek" : "Sample", picked: tr ? "Seçtin" : "Yours" },
});
