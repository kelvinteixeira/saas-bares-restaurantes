"use client";

import { useState } from "react";
import Link from "next/link";
import { MessageCircle, X } from "lucide-react";
import type { AbandonedCart } from "@/lib/types";
import { cartItemsLabel, cartsToRecover, recoveryLink, recoveryMessage, recoveryStats } from "@/lib/domain/recovery";
import { couponLabel, couponStatus } from "@/lib/domain/coupons";
import { formatClock, formatDuration, formatMoney, formatPhone, minutesBetween } from "@/lib/format";
import { dismissCart, markContacted } from "@/lib/store/recovery";
import { usePainel } from "@/components/painel/painel-context";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { attempt, useToast } from "@/components/ui/toast";

const MODE_LABEL = { delivery: "entrega", pickup: "retirada" } as const;

export default function RecuperarPage() {
  const { db, store, now } = usePainel();
  const toast = useToast();
  const [couponId, setCouponId] = useState("");
  const carts = db.carts ?? [];
  const list = cartsToRecover(carts, store.id, now);
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const stats = recoveryStats(carts, db.orders, store.id, weekAgo, new Date(now.getTime() + 60000));
  const coupons = (db.coupons ?? []).filter((c) => c.storeId === store.id && couponStatus(c, db.orders, now) === "active");
  const coupon = coupons.find((c) => c.id === couponId);
  const menuUrl = typeof window === "undefined" ? `/${store.slug}` : `${window.location.origin}/${store.slug}`;

  function chamar(cart: AbandonedCart) {
    // O link abre pelo próprio <a>; aqui só registra que a loja chamou.
    void attempt(toast, () => markContacted(cart));
  }

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        title="Recuperar vendas"
        subtitle="Quem digitou o WhatsApp no fechamento e não fez o pedido aparece aqui. Chame com uma mensagem pronta, e se a pessoa pedir, a venda conta como recuperada."
      />

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sacolas abandonadas" value={String(stats.abandoned)} hint="últimos 7 dias" />
        <Kpi label="Chamadas" value={String(stats.contacted)} />
        <Kpi label="Recuperadas" value={String(stats.recovered)} hint={stats.contacted ? `${Math.round((stats.recovered / stats.contacted) * 100)}% das chamadas` : undefined} />
        <Kpi label="Vendas recuperadas" value={formatMoney(stats.revenue)} />
      </div>

      <section className="mt-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Para chamar</h2>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted">Oferecer cupom</span>
            <Select className="h-9 w-auto min-w-[180px]" value={couponId} onChange={(e) => setCouponId(e.target.value)}>
              <option value="">Sem cupom</option>
              {coupons.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {couponLabel(c).toLowerCase()}
                </option>
              ))}
            </Select>
          </label>
        </div>
        {coupons.length === 0 && (
          <p className="mt-2 text-[13px] text-muted">
            Dica: crie um cupom em{" "}
            <Link href="/painel/cupons" className="font-medium text-accent hover:underline">
              Cupons
            </Link>{" "}
            (um <strong>VOLTA10</strong>, por exemplo) para oferecer na mensagem.
          </p>
        )}

        {list.length === 0 ? (
          <div className="mt-4 max-w-[620px] rounded-card border border-dashed border-control px-5 py-8 text-center">
            <p className="text-[15px] font-medium">Nenhuma sacola para chamar agora</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              Quando alguém digita o WhatsApp no fechamento do pedido e desiste, a sacola aparece aqui depois de 10 minutos parada. Pedido na
              mesa não entra. Se a pessoa pedir depois, sai da lista sozinha.
            </p>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line rounded-card border border-line">
            {list.map((cart) => {
              const message = recoveryMessage(cart, store, menuUrl, coupon);
              const idle = minutesBetween(new Date(cart.updatedAt), now);
              return (
                <li key={cart.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-medium">{cart.name || "Sem nome"}</span>
                      <span className="num text-sm text-muted">{formatPhone(cart.phone)}</span>
                      {cart.status === "contacted" && cart.contactedAt && (
                        <Pill tone="warning">Chamado às {formatClock(new Date(cart.contactedAt))}</Pill>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-sm">{cartItemsLabel(cart)}</p>
                    <p className="text-[13px] text-muted">
                      <span className="num font-medium text-ink">{formatMoney(cart.subtotal)}</span>
                      {cart.mode ? ` · ${MODE_LABEL[cart.mode]}` : ""} · parou há {formatDuration(idle)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <a
                      href={recoveryLink(cart, message)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={() => chamar(cart)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-control bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"
                    >
                      <MessageCircle className="size-4" strokeWidth={1.5} aria-hidden="true" />
                      {cart.status === "contacted" ? "Chamar de novo" : "Chamar no WhatsApp"}
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-9 px-0 text-muted hover:text-negative"
                      aria-label={`Descartar a sacola de ${cart.name || formatPhone(cart.phone)}`}
                      onClick={() => void attempt(toast, () => dismissCart(cart), "Sacola descartada")}
                    >
                      <X className="size-4" strokeWidth={1.5} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 max-w-[720px] text-[13px] leading-5 text-muted">
          A mensagem sai pronta com o primeiro nome, os itens e o link do cardápio; no mesmo celular, a sacola da pessoa ainda está lá. Sacolas com
          mais de 30 dias são apagadas sozinhas. Chame só quem deixou o WhatsApp para isso e respeite quem pedir para não receber mais.
        </p>
      </section>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-1 text-[22px] font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
