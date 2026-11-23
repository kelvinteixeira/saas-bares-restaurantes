"use client";

import Link from "next/link";
import { Check, MessageCircle } from "lucide-react";
import { useDb } from "@/lib/store/db";
import { storeBySlug } from "@/lib/store/actions";
import { BrandScope, StoreLogo, brandButton } from "@/components/cardapio/brand";
import { customerStatusLabel, isOpenOrder, statusFlow, statusLabel } from "@/lib/domain/orders";
import { formatClock, formatMoney, formatOrderNumber, onlyDigits } from "@/lib/format";
import { cn } from "@/lib/cn";

const PAYMENT_LABEL = { pix: "Pix", card: "Cartão", cash: "Dinheiro" } as const;

/** Acompanhamento ao vivo: muda sozinho quando a loja avança o pedido no painel. */
export function OrderTracking({ slug, id }: { slug: string; id: string }) {
  const db = useDb();
  if (!db) return <div className="min-h-dvh" aria-busy="true" />;
  const store = storeBySlug(db, slug);
  const order = store ? db.orders.find((o) => o.id === id && o.storeId === store.id) : null;

  if (!store || !order) {
    return (
      <main className="mx-auto max-w-[480px] px-4 py-16">
        <h1 className="text-[24px] leading-8 font-semibold">Pedido não encontrado</h1>
        <p className="mt-2 text-[15px] text-muted">
          Nesta versão de testes o pedido fica salvo só no aparelho em que foi feito.
        </p>
        <Link href={`/${slug}`} className="mt-6 inline-block text-sm font-medium text-accent hover:underline">
          Voltar ao cardápio
        </Link>
      </main>
    );
  }

  // Pedido feito na mesa: "Fazer outro pedido" volta já com a mesa marcada.
  const menuHref = order.mode === "table" && order.tableNumber ? `/${slug}?mesa=${order.tableNumber}` : `/${slug}`;
  const flow = statusFlow(order.mode);
  const reached = new Map(order.history.map((h) => [h.status, h.at]));
  const cancelled = order.status === "cancelado";
  const currentIndex = flow.indexOf(order.status);

  return (
    <BrandScope store={store}>
      <div className="mx-auto max-w-[640px] px-4 py-6 sm:px-6 sm:py-10">
        <Link href={menuHref} className="flex w-fit items-center gap-3">
          <StoreLogo store={store} size={44} className="border-0" />
          <span className="text-[15px] font-medium">{store.name}</span>
        </Link>

        <p className="mt-8 font-mono text-[15px] text-muted">Pedido {formatOrderNumber(order.number)}</p>
        <h1 className="mt-1 text-[26px] leading-8 font-semibold tracking-[-0.02em] sm:text-[30px] sm:leading-9" aria-live="polite">
          {customerStatusLabel(order.status, order.mode)}
        </h1>
        {isOpenOrder(order) && (
          <p className="mt-2 text-[15px] text-muted">
            Feito às {formatClock(new Date(order.createdAt))} · previsão até{" "}
            <span className="num font-medium text-ink">{formatClock(new Date(order.promisedAt))}</span>
          </p>
        )}

        {!cancelled && (
          <ol className="mt-8 flex flex-col" aria-label="Andamento do pedido">
            {flow.map((s, i) => {
              const at = reached.get(s);
              const done = i <= currentIndex;
              const current = i === currentIndex;
              return (
                <li key={s} className="relative flex gap-4 pb-6 last:pb-0">
                  {i < flow.length - 1 && (
                    <span
                      aria-hidden="true"
                      className={cn("absolute top-6 left-[11px] h-[calc(100%-24px)] w-0.5", i < currentIndex ? "bg-[var(--brand)]" : "bg-line")}
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "relative grid size-6 flex-none place-items-center rounded-full border-2",
                      done ? "border-[var(--brand)] bg-[var(--brand)] text-[var(--brand-ink)]" : "border-control bg-surface",
                    )}
                  >
                    {done && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="flex flex-1 items-baseline justify-between gap-3 pt-0.5">
                    <span className={cn("text-[15px]", current ? "font-semibold" : done ? "" : "text-muted")}>
                      {statusLabel(s, order.mode)}
                    </span>
                    {at && <span className="num text-sm text-muted">{formatClock(new Date(at))}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <section className="mt-10 rounded-card border border-line p-5" aria-labelledby="h-itens">
          <h2 id="h-itens" className="text-[17px] font-semibold">
            {order.mode === "table" ? `Mesa ${order.tableNumber}` : order.mode === "delivery" ? "Entrega" : "Retirada na loja"}
          </h2>
          {order.delivery && (
            <p className="mt-1 text-sm text-muted">
              {order.delivery.street}, {order.delivery.number} · {order.delivery.regionName}
            </p>
          )}
          {order.mode === "pickup" && store.address.street && (
            <p className="mt-1 text-sm text-muted">
              {store.address.street}, {store.address.number} · {store.address.district}
            </p>
          )}
          <ul className="mt-3 border-t border-rule pt-2">
            {order.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-3 py-1.5 text-[15px]">
                <span>
                  <span className="num">{it.quantity}×</span> {it.name}
                  {it.options.length > 0 && <span className="block text-[13px] text-muted">{it.options.map((o) => o.optionName).join(" · ")}</span>}
                </span>
                <span className="num">{formatMoney(it.unitPrice * it.quantity)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 border-t border-rule pt-2 text-[15px]">
            {order.deliveryFee > 0 && (
              <div className="flex justify-between py-0.5">
                <dt className="text-muted">Entrega</dt>
                <dd className="num">{formatMoney(order.deliveryFee)}</dd>
              </div>
            )}
            <div className="flex justify-between py-0.5 font-semibold">
              <dt>Total</dt>
              <dd className="num">{formatMoney(order.total)}</dd>
            </div>
            <div className="flex justify-between py-0.5 text-sm">
              <dt className="text-muted">Pagamento</dt>
              <dd>
                {PAYMENT_LABEL[order.payment.method]}
                {order.payment.changeFor ? ` · troco para ${formatMoney(order.payment.changeFor)}` : ""}
              </dd>
            </div>
          </dl>
        </section>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {store.phone && (
            <a
              href={`https://wa.me/55${onlyDigits(store.phone)}?text=${encodeURIComponent(`Olá! Sobre o pedido ${formatOrderNumber(order.number)}`)}`}
              target="_blank"
              rel="noreferrer"
              className={brandButton("flex-1")}
            >
              <MessageCircle className="size-5" strokeWidth={1.5} aria-hidden="true" />
              Falar com a loja
            </a>
          )}
          <Link
            href={menuHref}
            className="inline-flex h-12 flex-1 items-center justify-center rounded-full border border-control text-[15px] font-medium hover:bg-raised"
          >
            Fazer outro pedido
          </Link>
        </div>
      </div>
    </BrandScope>
  );
}
