import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">Sayfa bulunamadı</h1>
      <Link href="/" className="text-sm underline">Panele dön</Link>
    </main>
  );
}
