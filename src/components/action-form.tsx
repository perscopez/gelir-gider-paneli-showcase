"use client";

import { useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type Result = { ok: true } | { ok: false; error: string };

function Submit({ label, variant }: { label: string; variant: "default" | "outline" }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {label}
    </Button>
  );
}

// React formu her aksiyondan sonra sıfırlar; hatada veya resetOnSuccess=false ise girilen değerleri geri yazarız.
function restore(form: HTMLFormElement, data: FormData) {
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name || el.type === "file" || el.type === "hidden") continue;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) el.checked = data.getAll(el.name).includes(el.value);
    else {
      const v = data.get(el.name);
      if (typeof v === "string") el.value = v;
    }
  }
}

// Server action formu: sayfa hazır olmadan gönderilemez (değerler URL'ye sızmaz), sonuç toast ve satır içi mesajla gösterilir.
export function ActionForm({
  action, children, submit, className = "", variant = "default", resetOnSuccess = true, onSuccess, successMessage,
}: {
  action: (formData: FormData) => Promise<Result>;
  children: ReactNode;
  submit: string;
  className?: string;
  variant?: "default" | "outline";
  resetOnSuccess?: boolean;
  onSuccess?: () => void;
  successMessage?: string;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(data: FormData) {
    setError(null);
    let r: Result;
    try {
      r = await action(data);
    } catch {
      r = { ok: false, error: "Sunucuya ulaşılamadı. Tekrar dene." };
    }
    const form = ref.current;
    if (r.ok) {
      toast.success(successMessage ?? "Kaydedildi");
      onSuccess?.();
      if (form && !resetOnSuccess) setTimeout(() => restore(form, data), 50);
    } else {
      setError(r.error);
      toast.error(r.error);
      if (form) for (const ms of [50, 200]) setTimeout(() => restore(form, data), ms);
    }
  }

  return (
    <form ref={ref} action={handle} className={`group ${className}`}>
      {children}
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <Submit label={submit} variant={variant} />
        {error ? <span className="text-sm text-destructive" role="alert">{error}</span> : null}
      </div>
    </form>
  );
}
