"use client";

import { useState } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { usePainel } from "@/components/painel/painel-context";
import { Card, PageHeader } from "@/components/painel/page-header";
import { QueueStrip } from "@/components/painel/queue-strip";
import { HourlyBars } from "@/components/charts/hourly-bars";
import { ButtonLink } from "@/components/ui/button";
import {
  businessHourRange,
  hourlyBuckets,
  metricValue,
  modeSplit,
  ordersOfDay,
  summarize,
  topProducts,
  type HourBucket,
  type Metric,
} from "@/lib/domain/stats";
import { isLate, isOpenOrder } from "@/lib/domain/orders";
import { WEEKDAY_NAMES, formatClock, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";

const METRICS: { id: Metric; label: string }[] = [
  { id: "revenue", label: "Faturamento" },
  { id: "orders", label: "Pedidos" },
  { id: "ticket", label: "Ticket médio" },
];

function formatMetric(metric: Metric, v: number) {
  return metric === "orders" ? String(v) : formatMoney(v);
}

function formatDelta(metric: Metric, diff: number) {
  if (metric === "orders") return `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${Math.abs(diff)}`;
  return `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${formatMoney(Math.abs(diff))}`;
}

function moneyTick(cents: number) {
  return `R$ ${Math.round(cents / 100).toLocaleString("pt-BR")}`;
}

export default function VisaoGeralPage() {
  const { db, store, now } = usePainel();
  const [metric, setMetric] = useState<Metric>("revenue");

  const storeOrders = db.orders.filter((o) => o.storeId === store.id);
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const todayOrders = ordersOfDay(storeOrders, now);
  const today = summarize(todayOrders);
  const before = summarize(ordersOfDay(storeOrders, lastWeek, now));

  const weekday = WEEKDAY_NAMES[now.getDay()];
  const compareName = `${weekday[0].toUpperCase()}${weekday.slice(1)} ${now.getDay() === 0 || now.getDay() === 6 ? "passado" : "passada"}`;

  // O eixo cobre o expediente e também qualquer hora em que entrou pedido hoje (loja aberta à mão, por exemplo).
  const [openHour, closeHour] = businessHourRange(store, now);
  const orderHours = todayOrders.map((o) => new Date(o.createdAt).getHours());
  const fromHour = Math.min(openHour, ...orderHours);
  const toHour = Math.max(closeHour, ...orderHours);
  const revenueBuckets = hourlyBuckets(storeOrders, now, "revenue", fromHour, toHour);
  const orderBuckets = hourlyBuckets(storeOrders, now, "orders", fromHour, toHour);
  const buckets: HourBucket[] =
    metric === "revenue"
      ? revenueBuckets
      : metric === "orders"
        ? orderBuckets
        : revenueBuckets.map((b, i) => {
            const n = orderBuckets[i];
            return {
              hour: b.hour,
              value: b.value === null ? null : n.value ? Math.round(b.value / n.value) : 0,
              compare: n.compare ? Math.round(b.compare / n.compare) : 0,
            };
          });

  const open = storeOrders.filter(isOpenOrder);
  const late = open.filter((o) => isLate(o, now));
  const waiting = open.filter((o) => o.status === "novo");
  const split = modeSplit(todayOrders);
  const top = topProducts(todayOrders, 5);
  const topMax = top[0]?.quantity ?? 0;

  // Primeiros passos: cada um verificado nos dados, a porcentagem é real.
  const products = db.products.filter((p) => p.storeId === store.id);
  const steps = [
    { done: products.length >= 3, label: "Cadastrar pelo menos 3 itens no cardápio", href: "/painel/cardapio" },
    { done: Boolean(store.phone && store.address.street), label: "Informar WhatsApp e endereço", href: "/painel/configuracoes" },
    {
      done: store.pickup.enabled || (store.delivery.enabled && store.delivery.regions.some((r) => r.active)),
      label: "Definir retirada ou bairros de entrega",
      href: "/painel/configuracoes?aba=atendimento",
    },
    { done: Boolean(store.logo), label: "Enviar o logo da loja", href: "/painel/configuracoes" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  const finding = late.length ? (
    <span className="font-medium text-negative">
      {late.length === 1 ? "1 pedido passou" : `${late.length} pedidos passaram`} do horário prometido ao cliente.
    </span>
  ) : waiting.length ? (
    <span className="font-medium text-ink">
      {waiting.length === 1 ? "1 pedido esperando" : `${waiting.length} pedidos esperando`} você aceitar.
    </span>
  ) : (
    <>
      Hoje até {formatClock(now)}: {today.orders} {today.orders === 1 ? "pedido" : "pedidos"}, {formatMoney(today.revenue)}.
    </>
  );

  return (
    <div className="flex flex-col gap-6 px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        title="Visão geral"
        subtitle={finding}
        actions={
          <ButtonLink href="/painel/pedidos" variant="primary">
            {waiting.length ? `Abrir pedidos (${waiting.length} novos)` : "Abrir pedidos"}
          </ButtonLink>
        }
      />

      {doneCount < steps.length && (
        <Card
          title="Deixe a loja pronta para receber pedidos"
          aside={<span className="num">{Math.round((doneCount / steps.length) * 100)}% feito</span>}
        >
          <div className="mb-4 h-2 rounded-full bg-raised" aria-hidden="true">
            <div className="h-2 rounded-full bg-accent" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {steps.map((s) => (
              <li key={s.label}>
                <Link
                  href={s.href}
                  className="flex items-center gap-3 rounded-card border border-line px-3 py-2.5 text-sm hover:border-control"
                >
                  <span
                    className={cn(
                      "grid size-5 flex-none place-items-center rounded-full border",
                      s.done ? "border-positive bg-positive text-white" : "border-control",
                    )}
                  >
                    {s.done && <Check className="size-3" strokeWidth={2.5} aria-hidden="true" />}
                  </span>
                  <span className={cn(s.done && "text-muted line-through")}>{s.label}</span>
                  <span className="sr-only">{s.done ? "(feito)" : "(pendente)"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* O bloco principal: hoje contra o mesmo horário da semana passada. */}
      <section className="rounded-card border border-line" aria-label="Vendas de hoje">
        <div role="tablist" aria-label="Métrica do gráfico" className="grid grid-cols-3 border-b border-line">
          {METRICS.map((m) => {
            const value = metricValue(today, m.id);
            const prev = metricValue(before, m.id);
            const diff = value - prev;
            const selected = metric === m.id;
            return (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setMetric(m.id)}
                className={cn(
                  "relative flex flex-col items-start gap-1 px-3 pt-4 pb-3 text-left transition-colors hover:bg-raised/60 sm:px-5",
                  "border-r border-line last:border-r-0",
                )}
              >
                <span className={cn("text-[13px] sm:text-sm", selected ? "font-semibold text-ink" : "text-muted")}>
                  {m.label}
                  <span className="hidden sm:inline"> hoje</span>
                </span>
                <span className={cn("num text-[20px] leading-7 sm:text-[28px] sm:leading-9", selected ? "font-normal" : "font-light")}>
                  {formatMetric(m.id, value)}
                </span>
                <span className="num text-xs text-muted">
                  {prev === 0 && value > 0 ? (
                    // Crescer a partir de zero não é comparação: diz o fato em cinza.
                    <span>
                      {compareName} não tinha pedidos até {formatClock(now)}
                    </span>
                  ) : (
                    <>
                      <span
                        className={cn(
                          diff > 0 && "font-medium text-positive",
                          diff < 0 && "font-medium text-negative",
                        )}
                      >
                        {diff === 0 ? "sem diferença" : formatDelta(m.id, diff)}
                      </span>
                      <span className="hidden sm:inline">
                        {diff === 0 ? " para" : " vs"} {compareName.toLowerCase()} até {formatClock(now)}
                      </span>
                    </>
                  )}
                </span>
                {selected && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 bg-ink" />}
              </button>
            );
          })}
        </div>
        <div className="px-4 pt-4 pb-5 sm:px-5">
          <HourlyBars
            buckets={buckets}
            compareLabel={compareName}
            minTop={metric === "orders" ? 4 : 10000}
            formatTick={metric === "orders" ? (v) => String(v) : moneyTick}
            formatValue={(v) => formatMetric(metric, v)}
            label={`${METRICS.find((m) => m.id === metric)!.label} por hora hoje, comparado com ${compareName.toLowerCase()}`}
          />
          <div className="mt-4 flex flex-col gap-2 border-t border-rule pt-4 sm:flex-row sm:items-center sm:gap-6">
            <span className="text-sm text-muted">Pedidos de hoje por modalidade</span>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
              <span>
                Entrega <span className="num font-medium">{split.delivery}</span>
              </span>
              <span>
                Retirada <span className="num font-medium">{split.pickup}</span>
              </span>
              <span>
                Mesa <span className="num font-medium">{split.table}</span>
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-6 xl:grid-cols-[2fr_1fr]">
        <Card
          title="Fila agora"
          aside={
            <span>
              <span className="num">{open.length}</span> {open.length === 1 ? "pedido aberto" : "pedidos abertos"}
            </span>
          }
        >
          <QueueStrip orders={open} now={now} />
        </Card>

        <Card title="Mais pedidos hoje" aside={<span>por quantidade</span>}>
          {top.length === 0 ? (
            <p className="rounded-card border border-dashed border-control px-4 py-3 text-sm text-muted">
              Nenhum item vendido hoje ainda.
            </p>
          ) : (
            <ol>
              {top.map((p, i) => (
                <li key={p.productId} className="flex h-12 flex-col justify-center gap-1.5 border-t border-rule first:border-t-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-sm">{p.name}</span>
                    <span className="num flex-none text-sm">
                      <span className="font-medium">{p.quantity}</span>
                      <span className="text-muted"> un. · {formatMoney(p.revenue)}</span>
                    </span>
                  </div>
                  <div className="h-0.5 rounded-full bg-rule" aria-hidden="true">
                    <div
                      className={cn("h-0.5 rounded-full", i === 0 ? "bg-ink" : "bg-control")}
                      style={{ width: `${(p.quantity / topMax) * 88}%` }}
                    />
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
