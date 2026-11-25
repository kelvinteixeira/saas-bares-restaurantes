"use client";

import { useState } from "react";
import { Download, Printer } from "lucide-react";
import type { OrderMode } from "@/lib/types";
import { PAYMENT_KINDS, PAYMENT_KIND_LABEL } from "@/lib/domain/cash";
import { PERIOD_LABEL, ordersCsv, periodRange, salesReport, type Period } from "@/lib/domain/reports";
import { formatMoney, slugify } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePainel } from "@/components/painel/painel-context";
import { Card, PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

const MODE_LABEL: Record<OrderMode, string> = { delivery: "Entrega", pickup: "Balcão e retirada", table: "Mesa" };
const PERIODS: Period[] = ["hoje", "ontem", "7dias"];

const dayLabel = (d: Date) => d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

export default function RelatoriosPage() {
  const { db, store, now } = usePainel();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>("hoje");
  const { from, to } = periodRange(period, now);
  const r = salesReport({ storeId: store.id, orders: db.orders, tabs: db.tabs ?? [], payments: db.payments ?? [] }, from, to);
  const range =
    period === "7dias"
      ? `${from.toLocaleDateString("pt-BR")} a ${now.toLocaleDateString("pt-BR")}`
      : from.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  function download() {
    if (!r.orders.length) {
      toast("Nenhum pedido no período.", "negative");
      return;
    }
    // BOM para o Excel reconhecer os acentos.
    const blob = new Blob(["﻿" + ordersCsv(r.orders)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pedidos-${slugify(store.name)}-${period}-${from.toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const maxMode = Math.max(...Object.values(r.byMode).map((m) => m.revenue), 1);
  const maxDay = Math.max(...r.byDay.map((d) => d.revenue), 1);
  const maxItem = Math.max(...r.top.map((t) => t.quantity), 1);

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        title="Relatórios"
        subtitle={<span className="first-letter:uppercase">{range}</span>}
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Período" className="flex rounded-[10px] bg-raised p-1">
              {PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={period === p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "h-8 rounded-[8px] px-3 text-sm text-muted hover:text-ink",
                    period === p && "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
                  )}
                >
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
            <Button onClick={download}>
              <Download className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Planilha
            </Button>
            <Button onClick={() => window.print()} aria-label="Imprimir relatório">
              <Printer className="size-4" strokeWidth={1.5} aria-hidden="true" />
            </Button>
          </div>
        }
      />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Vendas" value={formatMoney(r.revenue)} hint={r.discounts ? `já sem ${formatMoney(r.discounts)} de cupons e cashback` : "itens + entrega"} />
        <Kpi label="Pedidos" value={String(r.count)} />
        <Kpi label="Ticket médio" value={formatMoney(r.ticket)} />
        <Kpi
          label="Taxa de serviço"
          value={formatMoney(r.serviceFee)}
          hint={r.tabsClosed ? `${r.tabsClosed} ${r.tabsClosed === 1 ? "mesa fechada" : "mesas fechadas"}${r.feeRemoved ? `, ${r.feeRemoved} sem taxa` : ""}` : "nenhuma mesa fechada"}
        />
        <Kpi
          label="Cancelados"
          value={String(r.cancelled.count)}
          hint={r.cancelled.count ? formatMoney(r.cancelled.revenue) : undefined}
          tone={r.cancelled.count ? "negative" : undefined}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Por canal">
          <ul className="flex flex-col gap-3 text-sm">
            {(Object.keys(MODE_LABEL) as OrderMode[]).map((m) => (
              <li key={m}>
                <div className="flex items-baseline justify-between gap-3">
                  <span>
                    {MODE_LABEL[m]} <span className="num text-muted">· {r.byMode[m].count}</span>
                  </span>
                  <span className="num font-medium">{formatMoney(r.byMode[m].revenue)}</span>
                </div>
                <Bar value={r.byMode[m].revenue} max={maxMode} />
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Recebido no caixa">
          <dl className="flex flex-col gap-1.5 text-sm">
            {PAYMENT_KINDS.map((k) => (
              <div key={k} className="flex justify-between">
                <dt className="text-muted">{PAYMENT_KIND_LABEL[k]}</dt>
                <dd className="num">{formatMoney(r.received[k])}</dd>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
              <dt>Total recebido</dt>
              <dd className="num">{formatMoney(r.receivedTotal)}</dd>
            </div>
            {r.changeGiven > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted">Troco dado (já descontado)</dt>
                <dd className="num">{formatMoney(r.changeGiven)}</dd>
              </div>
            )}
            {r.pending > 0 && (
              <div className="mt-2 flex justify-between rounded-[10px] bg-pill-warning-bg px-3 py-2 text-pill-warning-ink">
                <dt>Vendido e ainda sem pagamento registrado</dt>
                <dd className="num font-medium">{formatMoney(r.pending)}</dd>
              </div>
            )}
          </dl>
        </Card>

        <Card title="Itens mais vendidos" aside={r.top.length ? "quantidade" : undefined}>
          {r.top.length === 0 ? (
            <p className="text-sm text-muted">Nenhum item vendido no período.</p>
          ) : (
            <ol className="flex flex-col gap-2.5 text-sm">
              {r.top.map((t, i) => (
                <li key={t.productId}>
                  <div className="flex items-baseline gap-3">
                    <span className="num w-5 text-muted">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="num w-10 text-right font-medium">{t.quantity}</span>
                    <span className="num w-24 text-right text-muted">{formatMoney(t.revenue)}</span>
                  </div>
                  <div className="ml-8">
                    <Bar value={t.quantity} max={maxItem} />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {period === "7dias" && (
          <Card title="Por dia">
            <ul className="flex flex-col gap-2.5 text-sm">
              {r.byDay.map((d) => (
                <li key={d.day.toISOString()}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="capitalize">{dayLabel(d.day)}</span>
                    <span>
                      <span className="num text-muted">{d.count} ped. · </span>
                      <span className="num font-medium">{formatMoney(d.revenue)}</span>
                    </span>
                  </div>
                  <Bar value={d.revenue} max={maxDay} />
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <p className="mt-6 text-xs leading-5 text-muted">
        Vendas somam os pedidos não cancelados (itens + entrega); a taxa de serviço aparece à parte, pelas mesas fechadas no
        período. Recebido no caixa conta os pagamentos registrados. Os relatórios cobrem até os últimos 7 dias.
      </p>
    </div>
  );
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "negative" }) {
  return (
    <div className="rounded-card border border-line p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={cn("num mt-1 text-[22px] font-semibold", tone === "negative" && "text-negative")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  return (
    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-raised" aria-hidden="true">
      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((value / max) * 100)}%` }} />
    </div>
  );
}
