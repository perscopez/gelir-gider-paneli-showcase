"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionForm } from "@/components/action-form";

type Result = { ok: true } | { ok: false; error: string };

// Form bir diyalog içinde açılır; başarılı kayıttan sonra kapanır.
export function FormDialog({
  trigger, title, description, action, submit, children, className = "grid gap-3 sm:grid-cols-2", variant, resetOnSuccess,
}: {
  trigger: ReactElement;
  title: string;
  description?: string;
  action: (formData: FormData) => Promise<Result>;
  submit: string;
  children: ReactNode;
  className?: string;
  variant?: "default" | "outline";
  resetOnSuccess?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <ActionForm action={action} submit={submit} className={className} variant={variant} resetOnSuccess={resetOnSuccess} onSuccess={() => setOpen(false)}>
          {children}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
