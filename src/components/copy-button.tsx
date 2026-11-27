"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CopyButton({ text, label = "Kopyala" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button" variant="outline" size="sm"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* pano izni yok */ }
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}{done ? "Kopyalandı" : label}
    </Button>
  );
}
