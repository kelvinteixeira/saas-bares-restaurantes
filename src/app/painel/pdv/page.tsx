"use client";

import { useState } from "react";
import type { OrderMode, PaymentMethod, Product } from "@/lib/types";
import { formatMoney, formatOrderNumber, formatPhone, moneyInput, parseMoney } from "@/lib/format";
import { readableInk } from "@/lib/color";
import { pdvOrder } from "@/lib/store/pdv";
import { cn } from "@/lib/cn";
import { usePainel } from "@/components/painel/painel-context";
import { DraftLines, MenuBrowser, useDraft, useStoreMenu } from "@/components/painel/menu/menu-browser";
import { ItemSheet } from "@/components/cardapio/item-sheet";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";

const MODES: { value: OrderMode; label: string }[] = [
  { value: "pickup", label: "Balcão" },
  { value: "delivery", label: "Entrega" },
  { value: "table", label: "Mesa" },
];

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "pix", label: "Pix" },
  { value: "card", label: "Cartão" },
  { value: "cash", label: "Dinheiro" },
];

const EMPTY_ADDRESS = { regionId: "", street: "", number: "", complement: "" };

export default function PdvPage() {
  const { db, store } = usePainel();
  const toast = useToast();
  const { categories, products } = useStoreMenu(store, db.categories, db.products);
  const { draft, byId, add, setQty, clear, count, total: itemsTotal, qtyOf } = useDraft(products);
  const [sheet, setSheet] = useState<Product | null>(null);

  const [mode, setMode] = useState<OrderMode>("pickup");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [table, setTable] = useState(1);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [changeText, setChangeText] = useState("");
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);

  const regions = store.delivery.regions.filter((r) => r.active);
  const region = regions.find((r) => r.id === address.regionId);
  const fee = mode === "delivery" ? (region?.fee ?? 0) : 0;
  const total = itemsTotal + fee;
  const needsPayment = mode !== "table";
  const changeFor = method === "cash" && changeText.trim() ? parseMoney(changeText) : undefined;
  const tables = Array.from({ length: store.table.count }, (_, i) => i + 1);
  const busyTables = new Set((db.tabs ?? []).filter((t) => t.storeId === store.id && t.status !== "closed").map((t) => t.tableNumber));

  function tap(product: Product) {
    if (!product.available) return;
    if (product.optionGroups.length) setSheet(product);
    else add(product, {}, 1);
  }

  function reset() {
    clear();
    setName("");
    setPhone("");
    setAddress(EMPTY_ADDRESS);
    setMethod(null);
    setChangeText("");
    setNotes("");
  }

  async function send() {
    if (changeFor === null) {
      toast("Confira o valor para troco.", "negative");
      return;
    }
    setSending(true);
    const order = await attempt(toast, () =>
      pdvOrder({
        storeId: store.id,
        mode,
        lines: draft,
        customer: { name, phone },
        delivery: mode === "delivery" ? address : undefined,
        tableNumber: mode === "table" ? table : undefined,
        payment: { method: method ?? "card", changeFor: changeFor ?? undefined },
        notes,
      }),
    );
    setSending(false);
    if (!order) return;
    const where = mode === "table" ? ` na mesa ${table}` : "";
    toast(`Pedido ${formatOrderNumber(order.number)} lançado${where}`);
    reset();
  }

  const canSend = draft.length > 0 && !sending && (!needsPayment || method !== null);
  const sendLabel = sending
    ? "Lançando…"
    : needsPayment && !method
      ? "Escolha o pagamento"
      : `Lançar pedido · ${formatMoney(total)}`;
  const brand = { "--brand": store.brandColor, "--brand-ink": readableInk(store.brandColor) } as React.CSSProperties;

  return (
    <div style={brand} className="px-4 py-5 pb-28 sm:px-6 sm:py-6 lg:pb-6">
      <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.01em]">PDV</h1>
      <p className="mt-1 text-[15px] text-muted">Pedido de balcão, telefone ou mesa. Vale mesmo com a loja fechada no cardápio.</p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <MenuBrowser categories={categories} products={products} variant="grid" qtyOf={qtyOf} onTap={tap} />

        <aside id="ticket" className="h-fit rounded-card border border-line lg:sticky lg:top-6">
          <div className="p-4">
            <div role="radiogroup" aria-label="Tipo de pedido" className="grid grid-cols-3 rounded-[12px] bg-raised p-1">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.value}
                  onClick={() => setMode(m.value)}
                  className={cn(
                    "h-9 rounded-[9px] text-sm font-medium text-muted hover:text-ink",
                    mode === m.value && "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === "table" ? (
              <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium">
                Mesa
                <Select value={table} onChange={(e) => setTable(Number(e.target.value))}>
                  {tables.map((n) => (
                    <option key={n} value={n}>
                      Mesa {n}
                      {busyTables.has(n) ? " · ocupada (entra na comanda)" : ""}
                    </option>
                  ))}
                </Select>
              </label>
            ) : (
              <div className="mt-4 grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  <span>
                    Nome {mode === "pickup" && <span className="font-normal text-muted">(opcional)</span>}
                  </span>
                  <Input value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} placeholder={mode === "pickup" ? "Balcão" : ""} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  <span>
                    Telefone {mode === "pickup" && <span className="font-normal text-muted">(opcional)</span>}
                  </span>
                  <Input value={phone} inputMode="tel" autoComplete="off" onChange={(e) => setPhone(formatPhone(e.target.value))} placeholder="(81) 90000-0000" />
                </label>
              </div>
            )}

            {mode === "delivery" &&
              (regions.length === 0 ? (
                <p className="mt-3 rounded-[10px] bg-pill-warning-bg px-3 py-2 text-[13px] text-pill-warning-ink">
                  Nenhum bairro ativo. Cadastre em Configurações › Entrega e retirada.
                </p>
              ) : (
                <div className="mt-2 grid grid-cols-[1fr_96px] gap-2">
                  <label className="col-span-2 flex flex-col gap-1.5 text-sm font-medium">
                    Bairro
                    <Select value={address.regionId} onChange={(e) => setAddress({ ...address, regionId: e.target.value })}>
                      <option value="">Escolha o bairro</option>
                      {regions.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · entrega {formatMoney(r.fee)}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Rua
                    <Input value={address.street} maxLength={120} onChange={(e) => setAddress({ ...address, street: e.target.value })} />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Número
                    <Input value={address.number} maxLength={20} onChange={(e) => setAddress({ ...address, number: e.target.value })} />
                  </label>
                  <label className="col-span-2 flex flex-col gap-1.5 text-sm font-medium">
                    Complemento <span className="sr-only">(opcional)</span>
                    <Input value={address.complement} maxLength={120} placeholder="Apto, bloco, referência" onChange={(e) => setAddress({ ...address, complement: e.target.value })} />
                  </label>
                </div>
              ))}
          </div>

          <div className="border-t border-line">
            {draft.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">Toque nos itens ao lado para montar o pedido.</p>
            ) : (
              <DraftLines draft={draft} byId={byId} setQty={setQty} />
            )}
          </div>

          <div className="border-t border-line px-4 py-3">
            <label htmlFor="obs-pdv" className="text-sm font-medium">
              Observação
            </label>
            <Textarea id="obs-pdv" className="mt-2 min-h-14" maxLength={200} placeholder="Ex.: sem cebola, entregar no portão" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {needsPayment && (
            <div className="border-t border-line px-4 py-3">
              <p className="text-sm font-medium">Pagamento</p>
              <div role="radiogroup" aria-label="Forma de pagamento" className="mt-2 grid grid-cols-3 gap-2">
                {METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={method === m.value}
                    onClick={() => setMethod(m.value)}
                    className={cn(
                      "h-10 rounded-control border text-sm font-medium",
                      method === m.value ? "border-accent bg-accent-soft text-accent" : "border-control hover:bg-raised",
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              {method === "cash" && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <span className="whitespace-nowrap">Troco para R$</span>
                  <Input
                    inputMode="decimal"
                    className="max-w-[140px]"
                    placeholder={moneyInput(total)}
                    value={changeText}
                    aria-invalid={changeFor === null || (changeFor !== undefined && changeFor < total) ? true : undefined}
                    onChange={(e) => setChangeText(e.target.value)}
                  />
                  {changeFor ? changeFor >= total && <span className="num text-muted">troco {formatMoney(changeFor - total)}</span> : null}
                </label>
              )}
            </div>
          )}

          <div className="border-t border-line px-4 py-3">
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">
                  Itens <span className="num">({count})</span>
                </dt>
                <dd className="num">{formatMoney(itemsTotal)}</dd>
              </div>
              {mode === "delivery" && (
                <div className="flex justify-between">
                  <dt className="text-muted">Entrega</dt>
                  <dd className="num">{region ? formatMoney(fee) : "escolha o bairro"}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1">
                <dt className="font-semibold">{mode === "table" ? "Vai para a conta da mesa" : "Total"}</dt>
                <dd className="num text-[20px] font-semibold">{formatMoney(total)}</dd>
              </div>
            </dl>
            <Button variant="primary" size="lg" className="mt-3 hidden w-full lg:flex" disabled={!canSend} onClick={() => void send()}>
              {sendLabel}
            </Button>
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-3">
          <a href="#ticket" className="min-w-0 flex-1 text-sm">
            <span className="num block font-semibold">{formatMoney(total)}</span>
            <span className="block text-xs text-muted">{count ? `${count} ${count === 1 ? "item" : "itens"} · revisar` : "Nada escolhido"}</span>
          </a>
          <Button variant="primary" size="lg" disabled={!canSend} onClick={() => void send()}>
            {needsPayment && !method ? "Escolha o pagamento" : sending ? "Lançando…" : "Lançar"}
          </Button>
        </div>
      </div>

      <ItemSheet
        product={sheet}
        canOrder
        closedLabel=""
        onClose={() => setSheet(null)}
        onAdd={(selections, quantity, lineNotes) => {
          if (sheet) add(sheet, selections, quantity, lineNotes);
          setSheet(null);
        }}
      />
    </div>
  );
}
