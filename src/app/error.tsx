"use client";

import { Button } from "@/components/ui/button";

// Beklenmeyen bir hata olursa boş/kırık sayfa yerine anlaşılır bir ekran ve "tekrar dene" göster.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">Bir şeyler ters gitti</h1>
      <p className="text-sm text-neutral-500">Sayfa yüklenemedi. Tekrar deneyebilirsin; sorun sürerse bana şu kodu yaz{error.digest ? `: ${error.digest}` : "."}</p>
      <Button onClick={reset}>Tekrar dene</Button>
    </main>
  );
}
