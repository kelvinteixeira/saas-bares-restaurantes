"use client";

import Link from "next/link";
import type { Order } from "@/lib/types";
import { formatClock, formatDuration, formatOrderNumber, minutesBetween } from "@/lib/format";
import { isLate, modeLabel, statusLabel } from "@/lib/domain/orders";
import { cn } from "@/lib/cn";

const WINDOW_MIN = 60;

/**
 * "Fila agora": cada pedido aberto numa linha do tempo de uma hora para trás e uma para frente.
 * A barra vai de quando o pedido chegou até o horário prometido ao cliente; a linha vertical é agora.
 * O trecho depois do prometido fica vermelho: é o atraso.
 */
export function QueueStrip({ orders, now, limit = 5 }: { orders: Order[]; now: Date; limit?: number }) {
  const start = now.getTime() - WINDOW_MIN * 60000;
  const span = 2 * WINDOW_MIN * 60000;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / span) * 100));
  const shown = [...orders]
    .sort((a, b) => new Date(a.promisedAt).getTime() - new Date(b.promisedAt).getTime())
    .slice(0, limit);

  if (!orders.length) {
    return (
      <p className="rounded-card border border-dashed border-control px-4 py-3 text-sm text-muted">
        Nenhum pedido aberto agora. Os novos aparecem aqui assim que chegam.
      </p>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-[132px_1fr_96px] gap-3 pb-1 text-xs text-muted sm:grid-cols-[168px_1fr_112px]">
        <span>Pedido</span>
        <span className="relative">
          <span className="absolute left-0">{formatClock(new Date(start))}</span>
          <span className="absolute left-1/2 -translate-x-1/2 font-medium text-ink">agora</span>
          <span className="absolute right-0">{formatClock(new Date(start + span))}</span>
        </span>
        <span className="text-right">Prometido</span>
      </div>
      <ul>
        {shown.map((o) => {
          const created = new Date(o.createdAt).getTime();
          const promised = new Date(o.promisedAt).getTime();
          const late = isLate(o, now);
          const left = minutesBetween(now, new Date(promised));
          return (
            <li key={o.id}>
              <Link
                href={`/painel/pedidos?pedido=${o.id}`}
                className="grid h-12 grid-cols-[132px_1fr_96px] items-center gap-3 border-t border-rule hover:bg-raised/60 sm:grid-cols-[168px_1fr_112px]"
              >
                <span className="min-w-0">
                  <span className="font-mono text-[13px] font-medium">{formatOrderNumber(o.number)}</span>
                  <span className="block truncate text-xs text-muted">
                    {o.mode === "table" ? `Mesa ${o.tableNumber}` : modeLabel(o.mode)} · {statusLabel(o.status, o.mode)}
                  </span>
                </span>
                <span className="relative h-5" aria-hidden="true">
                  <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-rule" />
                  <span
                    className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/35"
                    style={{ left: `${pct(created)}%`, width: `${Math.max(1, pct(promised) - pct(created))}%` }}
                  />
                  {late && (
                    <span
                      className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-negative"
                      style={{ left: `${pct(promised)}%`, width: `${Math.max(1, 50 - pct(promised))}%` }}
                    />
                  )}
                  <span className="absolute top-0 left-1/2 h-full w-px bg-ink" />
                </span>
                <span className="text-right">
                  <span className="num block text-sm">{formatClock(new Date(promised))}</span>
                  <span className={cn("block text-xs", late ? "font-medium text-negative" : "text-muted")}>
                    {late ? `atrasado ${formatDuration(-left)}` : `faltam ${formatDuration(left)}`}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {orders.length > limit && (
        <Link href="/painel/pedidos" className="mt-2 inline-block text-sm font-medium text-accent hover:underline">
          Ver os {orders.length} pedidos abertos
        </Link>
      )}
    </div>
  );
}
