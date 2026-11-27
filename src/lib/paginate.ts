// Supabase/PostgREST tek istekte en çok 1.000 satır döndürür (sunucu sınırı); .limit(20000) bunu aşamaz. Büyük listeleri sayfa sayfa çeker.
// `build(from, to)` her sayfa için YENİ bir sorgu üretmeli ve kararlı bir sıralama (order) içermeli.
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
  opts: { pageSize?: number; max?: number } = {},
): Promise<T[]> {
  const size = opts.pageSize ?? 1000;
  const max = opts.max ?? 100_000;
  const out: T[] = [];
  for (let from = 0; from < max; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
