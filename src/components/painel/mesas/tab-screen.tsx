"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRightLeft, Plus, ReceiptText } from "lucide-react";
import type { Order, Store, Tab } from "@/lib/types";
import { openTabFor, tableMap, tabOrders, tabTotals, unservedOrders } from "@/lib/domain/tabs";
import { openSession, tabDue, tabPaid } from "@/lib/domain/cash";
import { registerPayment, setTabServiceFee } from "@/lib/store/cash";
import { CashClosedNotice, PaymentForm, PaymentList, type PayInput } from "@/components/painel/cash/payment-form";
import { formatClock, formatDuration, formatMoney, formatOrderNumber } from "@/lib/format";
import { advanceOrder } from "@/lib/store/actions";
import { closeTab, requestBill, transferTab } from "@/lib/store/tabs";
import { usePainel } from "@/components/painel/painel-context";
import { OrderStatusPill } from "@/components/painel/order-status-pill";
import { ItemPicker } from "@/components/painel/mesas/item-picker";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { attempt, useToast } from "@/components/ui/toast";

const SOURCE_LABEL = { cliente: "Cliente pelo QR", garcom: "Garçom", pdv: "Caixa" } as const;

export function TabScreen({ table }: { table: number }) {
  const { db, store, now, role } = usePainel();
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [closing, setClosing] = useState(false);
  const [busy, setBusy] = useState(false);

  const tabs = db.tabs ?? [];
  const tab = openTabFor(tabs, store.id, table);
  const exists = Number.isInteger(table) && table >= 1 && (table <= store.table.count || Boolean(tab));
  const canClose = role === "owner" || role === "manager" || role === "cashier";

  if (!exists) {
    return (
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <BackLink />
        <h1 className="mt-3 text-[22px] font-semibold">Mesa não encontrada</h1>
        <p className="mt-2 text-sm text-muted">O salão tem {store.table.count} mesas. Confira o número ou mude a quantidade nas configurações.</p>
      </div>
    );
  }

  if (adding) {
    return (
      <div className="px-4 py-5 sm:px-6 sm:py-6">
        <ItemPicker store={store} table={table} onCancel={() => setAdding(false)} onSent={() => setAdding(false)} />
      </div>
    );
  }

  const orders = tab ? tabOrders(tab, db.orders) : [];
  const totals = tab ? tabTotals(tab, db.orders) : null;
  const minutes = tab ? Math.max(0, Math.floor((now.getTime() - new Date(tab.openedAt).getTime()) / 60_000)) : 0;
  const bill = tab?.status === "bill_requested";
  const paid = tab ? tabPaid(tab, db.payments ?? []) : 0;

  async function run(work: () => Promise<void>, success: string) {
    setBusy(true);
    await attempt(toast, work, success);
    setBusy(false);
  }

  return (
    <div className="px-4 py-5 pb-28 sm:px-6 sm:py-6 lg:pb-6">
      <BackLink />
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="text-[26px] leading-8 font-semibold tracking-[-0.01em]">Mesa {table}</h1>
        {!tab ? <Pill>Livre</Pill> : bill ? <Pill tone="warning">Pediu a conta</Pill> : <Pill tone="accent">Ocupada</Pill>}
      </div>
      {tab && (
        <p className="mt-1 text-[15px] text-muted">
          Aberta às {formatClock(new Date(tab.openedAt))} · há {formatDuration(minutes)} · {orders.length}{" "}
          {orders.length === 1 ? "pedido" : "pedidos"}
        </p>
      )}

      {!tab ? (
        <div className="mt-6 max-w-[560px] rounded-card border border-dashed border-control px-5 py-8 text-center">
          <p className="text-[15px] font-medium">Mesa livre</p>
          <p className="mt-1 text-sm text-muted">Lance os primeiros itens e a comanda abre sozinha. Pedidos pelo QR desta mesa também entram nela.</p>
          <Button variant="primary" size="lg" className="mt-5" onClick={() => setAdding(true)}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Lançar itens
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-3">
            {orders.length === 0 && (
              <p className="rounded-card border border-dashed border-control px-5 py-6 text-sm text-muted">
                Mesa aberta, ainda sem pedidos. Toque em “Lançar itens”.
              </p>
            )}
            {orders.map((o) => (
              <OrderBlock key={o.id} order={o} />
            ))}
          </div>

          <aside className="flex h-fit flex-col gap-3 lg:sticky lg:top-6">
            <div className="rounded-card border border-line p-4">
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">Consumo</dt>
                  <dd className="num">{formatMoney(totals!.consumption)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">{tab.serviceFeeRate ? `Taxa de serviço (${tab.serviceFeeRate}%)` : "Sem taxa de serviço"}</dt>
                  <dd className="num">{formatMoney(totals!.fee)}</dd>
                </div>
                <div className="mt-1 flex items-baseline justify-between border-t border-line pt-3">
                  <dt className="text-[15px] font-semibold">Total</dt>
                  <dd className="num text-[22px] font-semibold">{formatMoney(totals!.total)}</dd>
                </div>
                {paid > 0 && (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-muted">Já recebido</dt>
                      <dd className="num">{formatMoney(paid)}</dd>
                    </div>
                    <div className="flex justify-between font-medium">
                      <dt>Falta receber</dt>
                      <dd className="num">{formatMoney(Math.max(0, totals!.total - paid))}</dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
            <div className="hidden lg:block">
              <Button variant="primary" size="lg" className="w-full" onClick={() => setAdding(true)}>
                <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
                Lançar itens
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                disabled={busy}
                onClick={() => void run(() => requestBill(tab.id, !bill), bill ? "Pedido de conta desfeito" : `Mesa ${table} pediu a conta`)}
              >
                <ReceiptText className="size-4" strokeWidth={1.5} aria-hidden="true" />
                {bill ? "Desfazer conta" : "Pedir a conta"}
              </Button>
              <Button disabled={busy} onClick={() => setTransferring(true)}>
                <ArrowRightLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
                Trocar mesa
              </Button>
            </div>
            {canClose ? (
              <Button variant={bill ? "primary" : "secondary"} disabled={busy} onClick={() => setClosing(true)}>
                {paid > 0 ? "Receber o restante" : "Receber conta"}
              </Button>
            ) : (
              <p className="text-xs leading-5 text-muted">Quem recebe e fecha a conta é o caixa, o gerente ou o dono.</p>
            )}
          </aside>
        </div>
      )}

      {tab && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface px-4 py-3 lg:hidden">
          <div className="flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="num block text-[17px] font-semibold">{formatMoney(totals!.total)}</span>
              <span className="block text-xs text-muted">{tab.serviceFeeRate ? `com ${tab.serviceFeeRate}% de serviço` : "total da mesa"}</span>
            </span>
            <Button variant="primary" size="lg" onClick={() => setAdding(true)}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              Lançar itens
            </Button>
          </div>
        </div>
      )}

      {tab && transferring && <TransferModal tab={tab} store={store} onClose={() => setTransferring(false)} />}
      {tab && closing && <ReceiveModal tab={tab} onClose={() => setClosing(false)} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/painel/mesas" className="inline-flex h-9 items-center gap-1.5 rounded-control pr-2 text-sm text-muted hover:text-ink">
      <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
      Mesas
    </Link>
  );
}

function OrderBlock({ order }: { order: Order }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const cancelled = order.status === "cancelado";
  return (
    <article className="rounded-card border border-line">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-3">
        <span className="num text-sm font-semibold">{formatOrderNumber(order.number)}</span>
        <span className="num text-[13px] text-muted">{formatClock(new Date(order.createdAt))}</span>
        <span className="text-[13px] text-muted">· {SOURCE_LABEL[order.source ?? "cliente"]}</span>
        <span className="ml-auto">
          <OrderStatusPill order={order} />
        </span>
      </header>
      <ul className={`flex flex-col gap-2 px-4 py-3 ${cancelled ? "line-through opacity-60" : ""}`}>
        {order.items.map((item, i) => (
          <li key={i} className="flex items-start gap-3 text-sm">
            <span className="num w-7 flex-none font-medium">{item.quantity}×</span>
            <span className="min-w-0 flex-1">
              <span className="block">{item.name}</span>
              {item.options.length > 0 && <span className="block text-xs text-muted">{item.options.map((o) => o.optionName).join(" · ")}</span>}
              {item.notes && <span className="block text-xs text-pill-warning-ink">{item.notes}</span>}
            </span>
            <span className="num">{formatMoney(item.unitPrice * item.quantity)}</span>
          </li>
        ))}
      </ul>
      {(order.notes || order.status === "pronto") && (
        <footer className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
          {order.notes && <p className="min-w-0 flex-1 text-[13px] text-pill-warning-ink">{order.notes}</p>}
          {order.status === "pronto" && (
            <Button
              size="sm"
              variant="primary"
              className="ml-auto"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await attempt(toast, () => advanceOrder(order.id));
                setBusy(false);
              }}
            >
              Marcar servido
            </Button>
          )}
        </footer>
      )}
    </article>
  );
}

function TransferModal({ tab, store, onClose }: { tab: Tab; store: Store; onClose: () => void }) {
  const { db, now } = usePainel();
  const toast = useToast();
  const router = useRouter();
  const free = tableMap(store, db.tabs ?? [], db.orders, now).filter((t) => t.status === "free");
  const [target, setTarget] = useState<number | null>(free[0]?.number ?? null);
  const [saving, setSaving] = useState(false);

  return (
    <Modal open title={`Trocar a mesa ${tab.tableNumber}`} onClose={onClose}>
      {free.length === 0 ? (
        <p className="text-sm text-muted">Todas as mesas estão ocupadas.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm leading-6 text-muted">A comanda e todos os pedidos dela vão para a mesa escolhida.</p>
          <label className="flex flex-col gap-2 text-sm font-medium">
            Mesa livre
            <Select value={target ?? ""} onChange={(e) => setTarget(Number(e.target.value))}>
              {free.map((t) => (
                <option key={t.number} value={t.number}>
                  Mesa {t.number}
                </option>
              ))}
            </Select>
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Voltar</Button>
            <Button
              variant="primary"
              disabled={!target || saving}
              onClick={async () => {
                if (!target) return;
                setSaving(true);
                const ok = await attempt(toast, async () => {
                  await transferTab(tab.id, target);
                  return true;
                }, `Comanda passou para a mesa ${target}`);
                setSaving(false);
                if (ok) router.replace(`/painel/mesas/${target}`);
              }}
            >
              {saving ? "Trocando…" : `Passar para a mesa ${target ?? ""}`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReceiveModal({ tab, onClose }: { tab: Tab; onClose: () => void }) {
  const { db, store } = usePainel();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const live = (db.tabs ?? []).find((t) => t.id === tab.id) ?? tab;
  const payments = (db.payments ?? []).filter((p) => p.tabId === tab.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const totals = tabTotals(live, db.orders);
  const due = tabDue(live, db.orders, db.payments ?? []);
  const pending = unservedOrders(live, db.orders);
  const cashOpen = Boolean(openSession(db.cashSessions ?? [], store.id));
  const feeFull = Math.round((totals.consumption * live.serviceFeeRate) / 100);

  async function pay(input: PayInput) {
    const result = await attempt(toast, () => registerPayment({ tabId: tab.id, ...input }));
    if (!result) return false;
    if (result.payment.changeGiven > 0) toast(`Troco: ${formatMoney(result.payment.changeGiven)}`);
    if (result.tabClosed) {
      toast(`Mesa ${live.tableNumber} paga e fechada`);
      router.replace("/painel/mesas");
    }
    return true;
  }

  return (
    <Modal open title={`Conta da mesa ${live.tableNumber}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Consumo</dt>
            <dd className="num">{formatMoney(totals.consumption)}</dd>
          </div>
          {live.serviceFeeRate > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Taxa de serviço ({live.serviceFeeRate}%)</dt>
              <dd className={`num ${live.serviceFeeRemoved ? "text-muted line-through" : ""}`}>{formatMoney(feeFull)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-2">
            <dt className="font-semibold">Total</dt>
            <dd className="num font-semibold">{formatMoney(totals.total)}</dd>
          </div>
        </dl>
        {live.serviceFeeRate > 0 && (
          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={live.serviceFeeRemoved}
              disabled={busy}
              onChange={async (e) => {
                setBusy(true);
                await attempt(toast, () => setTabServiceFee(tab.id, e.target.checked));
                setBusy(false);
              }}
              className="size-4 accent-[var(--color-accent)]"
            />
            Tirar a taxa de serviço (o cliente pediu)
          </label>
        )}
        {payments.length > 0 && (
          <div className="rounded-[10px] bg-raised px-3 py-2.5">
            <p className="mb-1.5 text-xs font-medium tracking-[0.06em] text-muted uppercase">Recebido</p>
            <PaymentList payments={payments} />
          </div>
        )}
        <div className="flex items-baseline justify-between">
          <span className="text-[15px] font-semibold">{due > 0 ? "Falta receber" : "Conta paga"}</span>
          <span className="num text-[26px] font-semibold">{formatMoney(Math.max(0, due))}</span>
        </div>
        {pending.length > 0 && (
          <p className="rounded-[10px] bg-pill-warning-bg px-3 py-2 text-[13px] leading-5 text-pill-warning-ink">
            {pending.length === 1 ? "1 pedido ainda não saiu" : `${pending.length} pedidos ainda não saíram`} da cozinha. Quando a conta
            fechar, eles ficam como servidos.
          </p>
        )}
        {due > 0 ? (
          cashOpen ? (
            <PaymentForm key={due} due={due} onPay={pay} />
          ) : (
            <CashClosedNotice />
          )
        ) : (
          <Button
            variant="primary"
            size="lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await attempt(toast, async () => {
                await closeTab(tab.id);
                return true;
              }, `Mesa ${live.tableNumber} fechada`);
              setBusy(false);
              if (ok) router.replace("/painel/mesas");
            }}
          >
            Fechar a mesa
          </Button>
        )}
      </div>
    </Modal>
  );
}
