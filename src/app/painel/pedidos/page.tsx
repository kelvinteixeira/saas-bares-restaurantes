"use client";

import { Suspense, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Order } from "@/lib/types";
import { usePainel } from "@/components/painel/painel-context";
import { PageHeader } from "@/components/painel/page-header";
import { OrderDetail } from "@/components/painel/order-detail";
import { OrderStatusPill } from "@/components/painel/order-status-pill";
import { Button } from "@/components/ui/button";
import { attempt, useToast } from "@/components/ui/toast";
import { advanceLabel, isLate, isOpenOrder, modeLabel } from "@/lib/domain/orders";
import { formatClock, formatDuration, formatMoney, formatOrderNumber, minutesBetween } from "@/lib/format";
import { advanceOrder, simulateOrder } from "@/lib/store/actions";
import { cn } from "@/lib/cn";

type Filter = "abertos" | "novos" | "preparo" | "prontos" | "finalizados";

const FILTERS: { id: Filter; label: string; match: (o: Order) => boolean }[] = [
  { id: "abertos", label: "Abertos", match: isOpenOrder },
  { id: "novos", label: "Novos", match: (o) => o.status === "novo" },
  { id: "preparo", label: "Em preparo", match: (o) => o.status === "em_preparo" },
  { id: "prontos", label: "Prontos", match: (o) => o.status === "pronto" },
  { id: "finalizados", label: "Finalizados hoje", match: (o) => !isOpenOrder(o) },
];

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export default function PedidosPage() {
  return (
    <Suspense>
      <Pedidos />
    </Suspense>
  );
}

function Pedidos() {
  const { db, store, now } = usePainel();
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filter = (params.get("filtro") as Filter) ?? "abertos";
  const selectedId = params.get("pedido");

  const setParams = (next: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
  };

  // Abertos de qualquer dia (um pedido da noite anterior ainda aberto continua na fila); finalizados só de hoje.
  const relevant = useMemo(
    () =>
      db.orders.filter(
        (o) => o.storeId === store.id && (isOpenOrder(o) || sameDay(new Date(o.createdAt), now)),
      ),
    [db.orders, store.id, now],
  );

  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, relevant.filter(f.match).length])) as Record<Filter, number>;
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const list = relevant.filter(active.match).sort((a, b) => {
    if (active.id === "finalizados") return b.createdAt.localeCompare(a.createdAt);
    if (a.status === "novo" && b.status !== "novo") return -1;
    if (b.status === "novo" && a.status !== "novo") return 1;
    return a.promisedAt.localeCompare(b.promisedAt);
  });
  const selected = selectedId ? db.orders.find((o) => o.id === selectedId && o.storeId === store.id) ?? null : null;
  const lateCount = relevant.filter((o) => isLate(o, now)).length;

  const subtitle =
    counts.abertos === 0
      ? "Nenhum pedido aberto. Os novos aparecem aqui na hora, com aviso sonoro."
      : `${counts.novos} ${counts.novos === 1 ? "novo" : "novos"} · ${counts.abertos} ${counts.abertos === 1 ? "aberto" : "abertos"}${lateCount ? ` · ${lateCount} ${lateCount === 1 ? "atrasado" : "atrasados"}` : ""}`;

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <div className={cn("no-print", selected && "hidden xl:block")}>
        <PageHeader
          title="Pedidos"
          subtitle={subtitle}
          actions={
            <Button
              onClick={async () => {
                const o = await attempt(toast, () => simulateOrder(store.id));
                if (o === null) toast("Cadastre itens disponíveis no cardápio para simular um pedido.", "negative");
              }}
              title="Cria um pedido de teste com itens do seu cardápio"
            >
              Simular pedido de teste
            </Button>
          }
        />

        <div
          role="tablist"
          aria-label="Filtrar pedidos"
          className="no-print -mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0"
        >
          {FILTERS.map((f) => {
            const on = f.id === active.id;
            return (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setParams({ filtro: f.id === "abertos" ? null : f.id })}
                className={cn(
                  "flex min-w-[132px] flex-none flex-col items-start justify-center gap-0.5 rounded-card border px-3 py-2.5 text-left transition-colors sm:min-w-0",
                  on ? "border-[1.5px] border-accent bg-accent-soft" : "border-line hover:border-control",
                )}
              >
                <span className="text-[13px] text-muted">{f.label}</span>
                <span className="num text-base font-semibold">{counts[f.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5 grid items-start gap-6 xl:grid-cols-[1fr_400px]">
        <section aria-label={active.label} className={cn("no-print min-w-0", selected && "hidden xl:block")}>
          {list.length === 0 ? (
            <p className="rounded-card border border-dashed border-control px-4 py-3 text-sm text-muted">
              {active.id === "finalizados" ? "Nenhum pedido finalizado hoje." : `Nenhum pedido em "${active.label}".`}
            </p>
          ) : (
            <ul className="rounded-card border border-line">
              {list.map((o) => (
                <OrderRow
                  key={o.id}
                  order={o}
                  now={now}
                  selected={o.id === selected?.id}
                  onSelect={() => setParams({ pedido: o.id })}
                  onAdvance={() => {
                    const label = advanceLabel(o);
                    void attempt(
                      toast,
                      () => advanceOrder(o.id),
                      label ? `${formatOrderNumber(o.number)}: ${label.toLowerCase()}` : undefined,
                    );
                  }}
                />
              ))}
            </ul>
          )}
        </section>

        <aside aria-label="Detalhe do pedido" className={cn("xl:sticky xl:top-6", !selected && "hidden xl:block")}>
          {selected ? (
            <div className="rounded-card border border-line p-5">
              <OrderDetail order={selected} now={now} onBack={() => setParams({ pedido: null })} />
            </div>
          ) : (
            <p className="rounded-card border border-dashed border-control px-4 py-3 text-sm text-muted">
              Escolha um pedido para ver a comanda completa, imprimir ou falar com o cliente.
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}

function OrderRow({
  order,
  now,
  selected,
  onSelect,
  onAdvance,
}: {
  order: Order;
  now: Date;
  selected: boolean;
  onSelect: () => void;
  onAdvance: () => void;
}) {
  const action = advanceLabel(order);
  const late = isLate(order, now);
  const age = minutesBetween(new Date(order.createdAt), now);
  const where =
    order.mode === "table"
      ? `Mesa ${order.tableNumber}`
      : order.mode === "delivery"
        ? `Entrega · ${order.delivery?.regionName ?? ""}`
        : modeLabel(order.mode);
  const summary = order.items.map((it) => `${it.quantity}× ${it.name}`).join(", ");

  return (
    <li
      className={cn(
        "relative grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 border-t border-rule px-4 py-3 first:border-t-0 sm:grid-cols-[124px_1fr_auto_128px]",
        selected ? "bg-active" : "hover:bg-raised/60",
      )}
    >
      <span className="flex flex-col">
        {/* O botão cobre a linha inteira; o botão de ação fica por cima dele. */}
        <button
          type="button"
          onClick={onSelect}
          aria-current={selected ? "true" : undefined}
          className="text-left font-mono text-sm font-medium after:absolute after:inset-0 after:content-['']"
        >
          {formatOrderNumber(order.number)}
          <span className="sr-only">, ver detalhes</span>
        </button>
        <span className="num text-xs text-muted">
          {formatClock(new Date(order.createdAt))}
          {isOpenOrder(order) && (age < 1 ? " · agora" : ` · há ${formatDuration(age)}`)}
        </span>
      </span>
      <span className="col-span-2 min-w-0 sm:col-span-1">
        <span className="block truncate text-sm font-medium">
          {/* Pedido do garçom ou do PDV na mesa já se chama "Mesa N": não repete. */}
          {order.customer.name === where ? where : (
            <>
              {order.customer.name} <span className="font-normal text-muted">· {where}</span>
            </>
          )}
        </span>
        <span className="block truncate text-[13px] text-muted">{summary}</span>
      </span>
      <span className="row-start-1 flex flex-col items-end gap-1 sm:row-auto">
        <span className="num text-sm font-medium">{formatMoney(order.total)}</span>
        <span className="flex items-center gap-2">
          {late && <span className="text-xs font-medium text-negative">atrasado</span>}
          <OrderStatusPill order={order} />
        </span>
      </span>
      <span className="relative z-10 col-span-2 flex justify-end sm:col-span-1">
        {action ? (
          <button
            type="button"
            onClick={onAdvance}
            className="h-9 w-full rounded-control border border-control bg-surface px-3 text-[13px] font-medium hover:bg-raised sm:w-[128px]"
          >
            {action}
            <span className="sr-only"> o pedido {formatOrderNumber(order.number)}</span>
          </button>
        ) : (
          <span className="hidden text-xs text-muted sm:block">—</span>
        )}
      </span>
    </li>
  );
}
