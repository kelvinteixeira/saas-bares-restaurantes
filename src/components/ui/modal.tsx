"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Diálogo nativo: foco preso, Esc fecha, fundo inerte. No celular vira folha de baixo. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
  titleClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  titleClassName?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // O navegador põe o foco no primeiro botão (o de fechar); o campo marcado recebe o foco.
      dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        // O aviso "close" do navegador chega depois, de forma assíncrona, e pode chegar atrasado.
        // Se a janela já foi reaberta (o cliente tocou noutro item logo em seguida), o aviso é
        // velho e não pode fechar a janela nova. Um fechamento de verdade (Esc) sempre chega com
        // a janela já fechada.
        if (ref.current?.open) return;
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-label={title}
      className={cn(
        "m-0 mt-auto w-full max-w-none rounded-t-[16px] bg-surface p-0 text-ink shadow-[0_12px_40px_rgba(0,0,0,0.18)] sm:m-auto sm:w-[520px] sm:rounded-[16px]",
        "max-h-[92dvh] backdrop:bg-black/40",
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-center justify-between gap-4 px-5 pt-4 pb-3">
            <h2 className={cn("text-base font-semibold", titleClassName)}>{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="grid size-9 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          <div className="overflow-y-auto px-5 pb-5">{children}</div>
          {footer && <div className="border-t border-rule px-5 py-3">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
