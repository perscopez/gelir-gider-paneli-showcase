"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ProviderTest({ provider, label, action }: { provider: string; label: string; action: (fd: FormData) => Promise<{ ok: boolean; message: string }> }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="outline" size="sm" disabled={pending}
        onClick={() => start(async () => {
          const fd = new FormData(); fd.set("provider", provider);
          const r = await action(fd);
          setResult(r);
          (r.ok ? toast.success : toast.error)(r.message);
        })}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}{label}
      </Button>
      {result ? <span className={`text-xs ${result.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`} role="status">{result.message}</span> : null}
    </div>
  );
}
