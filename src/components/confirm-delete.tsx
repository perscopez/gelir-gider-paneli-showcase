"use client";

import { useState, useTransition, type ReactElement } from "react";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Silme/arşivleme öncesi onay: yanlışlıkla tıklamayı önler.
export function ConfirmDelete({
  action, id, trigger, title = "Silinsin mi?", description = "Bu işlem geri alınamaz.", confirm = "Sil", cancel = "İptal", done = "Silindi",
}: {
  action: (formData: FormData) => Promise<unknown>;
  id: string;
  trigger: ReactElement;
  title?: string;
  description?: string;
  confirm?: string;
  cancel?: string;
  done?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancel}</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const fd = new FormData();
                fd.set("id", id);
                try {
                  await action(fd);
                  toast.success(done);
                  setOpen(false);
                } catch {
                  toast.error("Silinemedi. Tekrar dene.");
                }
              })
            }
          >
            {confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
