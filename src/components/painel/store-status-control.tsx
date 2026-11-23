"use client";

import { useId } from "react";
import type { ManualStatus, Store } from "@/lib/types";
import { storeStatus } from "@/lib/domain/hours";
import { setManualStatus } from "@/lib/store/actions";
import { cn } from "@/lib/cn";

export function StoreStatusControl({ store, now, className }: { store: Store; now: Date; className?: string }) {
  const id = useId();
  const status = storeStatus(store, now);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="flex items-center gap-2 text-sm">
        <span
          aria-hidden="true"
          className={cn("size-2 flex-none rounded-full", status.open ? "bg-positive" : "bg-negative")}
        />
        <span className="font-medium">{status.open ? "Loja aberta" : "Loja fechada"}</span>
        <span className="hidden text-muted xl:inline">{status.label.replace(/^Fechado · /, "")}</span>
      </span>
      <label htmlFor={id} className="sr-only">
        Controle de abertura da loja
      </label>
      <select
        id={id}
        value={store.manualStatus}
        onChange={(e) => setManualStatus(store.id, e.target.value as ManualStatus)}
        className="h-8 rounded-control border border-control bg-surface px-2 pr-7 text-[13px] text-ink hover:bg-raised"
      >
        <option value="auto">Seguir horários</option>
        <option value="open">Abrir agora</option>
        <option value="closed">Fechar agora</option>
      </select>
    </div>
  );
}
