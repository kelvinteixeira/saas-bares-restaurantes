"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { cashbackCustomers, cashbackOf } from "@/lib/domain/cashback";
import { formatMoney, formatPhone } from "@/lib/format";
import { saveCashbackSettings } from "@/lib/store/cashback";
import { usePainel } from "@/components/painel/painel-context";
import { Card, PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Input, Switch } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });

export default function CashbackPage() {
  const { db, store, now } = usePainel();
  const entries = (db.cashbackEntries ?? []).filter((e) => e.storeId === store.id);
  const customers = cashbackCustomers(entries, db.orders, store.id, now);
  const open = customers.reduce((s, c) => s + c.balance, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const thisMonth = entries.filter((e) => new Date(e.createdAt).getTime() >= monthStart);
  const earnedMonth = thisMonth.filter((e) => e.kind === "earn").reduce((s, e) => s + e.amount, 0);
  const usedMonth = thisMonth.filter((e) => e.kind === "spend").reduce((s, e) => s + e.amount, 0);
  const cb = cashbackOf(store);

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader title="Cashback" subtitle="O cliente ganha uma parte de cada pedido concluído e usa nos próximos, pelo WhatsApp." />

      <div className="mt-6 grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
        <Settings key={JSON.stringify(cb)} />

        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid grid-cols-3 gap-3">
            <Kpi label="Saldo dos clientes" value={formatMoney(open)} hint="ainda para usar" />
            <Kpi label="Gerado no mês" value={formatMoney(earnedMonth)} />
            <Kpi label="Usado no mês" value={formatMoney(usedMonth)} />
          </div>

          <Card title="Clientes" aside={customers.length ? `${customers.length}` : undefined} bodyClassName={customers.length ? "px-0 pb-1" : undefined}>
            {customers.length === 0 ? (
              <p className="text-sm leading-6 text-muted">
                {cb.enabled
                  ? "Ninguém tem cashback ainda. O saldo aparece aqui quando o primeiro pedido com WhatsApp for concluído."
                  : "Ligue o cashback ao lado. Os clientes ganham a partir dos próximos pedidos concluídos."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {customers.map((c) => {
                  const text = `Oi${c.name ? `, ${c.name.split(" ")[0]}` : ""}! Você tem ${formatMoney(c.balance)} de cashback no ${store.name}. Use no próximo pedido: ${typeof window === "undefined" ? "" : window.location.origin}/${store.slug}`;
                  return (
                    <li key={c.phone} className="flex items-center gap-4 px-5 py-3 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.name || "Cliente"}</span>
                        <span className="num block text-[13px] whitespace-nowrap text-muted">{formatPhone(c.phone)}</span>
                        <span className="num block text-[13px] text-muted">
                          ganhou {formatMoney(c.earned)} · usou {formatMoney(c.spent)} · último em {shortDate(c.lastAt)}
                        </span>
                      </span>
                      <span className="num text-[15px] font-semibold whitespace-nowrap">{formatMoney(c.balance)}</span>
                      {c.balance > 0 && (
                        <a
                          href={`https://wa.me/55${c.phone}?text=${encodeURIComponent(text)}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Lembrar ${c.name || formatPhone(c.phone)} do saldo pelo WhatsApp`}
                          className="grid size-9 place-items-center rounded-control text-muted hover:bg-raised hover:text-ink"
                        >
                          <MessageCircle className="size-4" strokeWidth={1.5} />
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Settings() {
  const { store } = usePainel();
  const toast = useToast();
  const cb = cashbackOf(store);
  const [enabled, setEnabled] = useState(cb.enabled);
  const [rate, setRate] = useState(String(cb.rate));
  const [days, setDays] = useState(String(cb.validDays));
  const [saving, setSaving] = useState(false);
  const dirty = enabled !== cb.enabled || Number(rate) !== cb.rate || Number(days) !== cb.validDays;
  const example = Math.round((10000 * (Number(rate) || 0)) / 100);

  return (
    <Card title="Como funciona na sua loja" className="h-fit">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          await attempt(toast, () => saveCashbackSettings(store.id, { enabled, rate: Number(rate), validDays: Number(days) }), enabled ? "Cashback ligado" : "Cashback salvo");
          setSaving(false);
        }}
      >
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Dar cashback</span>
          <Switch checked={enabled} onChange={setEnabled} label="Dar cashback" />
        </div>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Porcentagem de volta
          <span className="flex items-center gap-2">
            <Input inputMode="numeric" className="max-w-[90px]" value={rate} onChange={(e) => setRate(e.target.value.replace(/\D/g, "").slice(0, 2))} />
            <span className="font-normal text-muted">% do que o cliente pagou nos itens</span>
          </span>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Validade do saldo
          <span className="flex items-center gap-2">
            <Input inputMode="numeric" className="max-w-[90px]" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 3))} />
            <span className="font-normal text-muted">dias</span>
          </span>
        </label>
        <p className="rounded-[10px] bg-raised px-3 py-2.5 text-[13px] leading-5 text-muted">
          Exemplo: num pedido de R$ 100,00 em itens, o cliente ganha <span className="num font-medium text-ink">{formatMoney(example)}</span> quando o
          pedido é concluído, e usa no checkout dos próximos, digitando o mesmo WhatsApp. A entrega não conta, e o saldo usado volta se o pedido for
          cancelado.
        </p>
        <Button type="submit" variant="primary" disabled={!dirty || saving}>
          {saving ? "Salvando…" : "Salvar"}
        </Button>
      </form>
    </Card>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-line p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-1 text-[20px] font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}
