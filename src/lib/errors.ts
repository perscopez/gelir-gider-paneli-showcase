// Kullanıcıya (Telegram vb.) aynen gösterilebilecek, anlaşılır hatalar. Diğer tüm hatalar sunucuda loglanır, kullanıcıya genel mesaj gider
// (veritabanı/altyapı ayrıntıları dışarı sızmasın).
export class UserFacingError extends Error {}

export const GENERIC_ERROR = "Bir hata oluştu, biraz sonra tekrar dene. Sorun sürerse Vercel loglarına bak.";

export function userMessage(e: unknown, context: string): string {
  if (e instanceof UserFacingError) return e.message;
  console.error(`[${context}]`, e);
  return GENERIC_ERROR;
}
