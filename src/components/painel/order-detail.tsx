"use client";

import { useState } from "react";
import { ArrowLeft, MessageCircle, Printer } from "lucide-react";
import type { Order } from "@/lib/types";
import {
  advanceLabel,
  canCancel,
  isLate,
  modeLabel,
  statusLabel,
} from "@/lib/domain/orders";
import { formatClock, formatDuration, formatMoney, formatOrderNumber, formatPhone, minutesBetween, onlyDigits } from "@/lib/format";
import { advanceOrder, cancelOrder } from "@/lib/store/actions";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { usePainel } from "@/components/painel/painel-context";
import { CashClosedNotice, PaymentForm, PaymentList, type PayInput } from "@/components/painel/cash/payment-form";
import { openSession, orderDue, orderPaid } from "@/lib/domain/cash";
import { registerPayment } from "@/lib/store/cash";
import { Modal } from "@/components/ui/modal";
import { OrderStatusPill } from "@/components/painel/order-status-pill";
import { attempt, useToast } from "@/components/ui/toast";

const PAYMENT_LABEL = { pix: "Pix na entrega", card: "Cartão na entrega", cash: "Dinheiro", tab: "Na conta da mesa" } as const;

export function OrderDetail({ order, now, onBack }: { order: Order; now: Date; onBack?: () => void }) {
  const toast = useToast();
  const { db } = usePainel();
  // Depois de receber no caixa, vale o que foi registrado; a forma combinada no pedido some.
  const received = (db.payments ?? []).some((p) => p.orderId === order.id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const action = advanceLabel(order);
  const late = isLate(order, now);
  const minutesLeft = minutesBetween(now, new Date(order.promisedAt));
  const change =
    order.payment.method === "cash" && order.payment.changeFor ? order.payment.changeFor - order.total : 0;

  return (
    <article className="print-area flex flex-col" aria-label={`Pedido ${formatOrderNumber(order.number)}`}>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="no-print mb-3 flex h-10 w-fit items-center gap-2 rounded-control pr-3 text-sm text-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Voltar para a lista
        </button>
      )}

      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-mono text-[22px] leading-7 font-medium">{formatOrderNumber(order.number)}</h2>
          <p className="mt-1 text-sm text-muted">
            Chegou às {formatClock(new Date(order.createdAt))} · prometido para {formatClock(new Date(order.promisedAt))}
          </p>
        </div>
        <OrderStatusPill order={order} />
      </header>

      {late && (
        <p className="mt-3 rounded-card bg-pill-negative-bg px-3 py-2 text-sm text-pill-negative-ink">
          Atrasado {formatDuration(-minutesLeft)} em relação ao horário prometido.
        </p>
      )}

      <section className="mt-5 border-t border-rule pt-4">
        <h3 className="text-xs text-muted">{modeLabel(order.mode)}</h3>
        <p className="mt-1 text-[15px] font-medium">{order.customer.name}</p>
        {order.mode === "table" && <p className="text-sm">Mesa {order.tableNumber}</p>}
        {order.delivery && (
          <p className="text-sm">
            {order.delivery.street}, {order.delivery.number}
            {order.delivery.complement ? ` · ${order.delivery.complement}` : ""}
            <span className="block text-muted">
              {order.delivery.regionName}
              {order.delivery.reference ? ` · ${order.delivery.reference}` : ""}
            </span>
          </p>
        )}
        {order.customer.phone && (
          <a
            href={`https://wa.me/55${onlyDigits(order.customer.phone)}`}
            target="_blank"
            rel="noreferrer"
            className="no-print mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
          >
            <MessageCircle className="size-4" strokeWidth={1.5} aria-hidden="true" />
            {formatPhone(order.customer.phone)}
          </a>
        )}
      </section>

      <section className="mt-5 border-t border-rule pt-4">
        <h3 className="text-xs text-muted">Itens</h3>
        <ul className="mt-1">
          {order.items.map((it, i) => (
            <li key={i} className="flex justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="num font-medium">{it.quantity}×</span> {it.name}
                {it.options.length > 0 && (
                  <span className="block text-[13px] text-muted">{it.options.map((o) => o.optionName).join(" · ")}</span>
                )}
                {it.notes && <span className="block text-[13px] text-warning">Obs.: {it.notes}</span>}
              </span>
              <span className="num flex-none">{formatMoney(it.unitPrice * it.quantity)}</span>
            </li>
          ))}
        </ul>
        {order.notes && (
          <p className="mt-2 rounded-card bg-pill-warning-bg px-3 py-2 text-sm text-pill-warning-ink">Observação: {order.notes}</p>
        )}
        <dl className="mt-3 border-t border-rule pt-3 text-sm">
          <div className="flex justify-between py-0.5">
            <dt className="text-muted">Subtotal</dt>
            <dd className="num">{formatMoney(order.subtotal)}</dd>
          </div>
          {order.mode === "delivery" && (
            <div className="flex justify-between py-0.5">
              <dt className="text-muted">Entrega</dt>
              <dd className="num">{formatMoney(order.deliveryFee)}</dd>
            </div>
          )}
          {(order.discount ?? 0) > 0 && (
            <div className="flex justify-between py-0.5">
              <dt className="text-muted">Cupom {order.couponCode}</dt>
              <dd className="num">−{formatMoney(order.discount!)}</dd>
            </div>
          )}
          <div className="flex justify-between py-1 text-[15px] font-semibold">
            <dt>Total</dt>
            <dd className="num">{formatMoney(order.total)}</dd>
          </div>
          {!received && (
            <div className="flex justify-between py-0.5">
              <dt className="text-muted">Pagamento</dt>
              <dd>{PAYMENT_LABEL[order.payment.method]}</dd>
            </div>
          )}
          {change > 0 && !received && (
            <div className="flex justify-between py-0.5">
              <dt className="text-muted">Troco para {formatMoney(order.payment.changeFor!)}</dt>
              <dd className="num font-medium">{formatMoney(change)}</dd>
            </div>
          )}
        </dl>
        {!order.tabId && <OrderPayment order={order} />}
      </section>

      <section className="mt-5 border-t border-rule pt-4">
        <h3 className="text-xs text-muted">Andamento</h3>
        <ol className="mt-2 flex flex-col gap-1.5 text-sm">
          {order.history.map((h, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>{statusLabel(h.status, order.mode)}</span>
              <span className="num text-muted">{formatClock(new Date(h.at))}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="no-print mt-6 flex flex-wrap gap-2">
        {action && (
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            onClick={() =>
              void attempt(toast, () => advanceOrder(order.id), `${formatOrderNumber(order.number)}: ${action.toLowerCase()}`)
            }
          >
            {action}
          </Button>
        )}
        <Button size="lg" onClick={() => window.print()} aria-label="Imprimir comanda">
          <Printer className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Imprimir
        </Button>
        {canCancel(order) && (
          <Button size="lg" variant="danger" onClick={() => setConfirmCancel(true)}>
            Cancelar
          </Button>
        )}
      </div>

      <Modal
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={`Cancelar o pedido ${formatOrderNumber(order.number)}?`}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setConfirmCancel(false)}>Manter pedido</Button>
            <Button
              variant="danger"
              onClick={() => {
                setConfirmCancel(false);
                void attempt(toast, () => cancelOrder(order.id), `${formatOrderNumber(order.number)} cancelado`);
              }}
            >
              Cancelar pedido
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6">
          {order.customer.name} vai ver o pedido como cancelado na página de acompanhamento. Se ele já pagou, combine a
          devolução pelo WhatsApp. Isso não pode ser desfeito.
        </p>
      </Modal>
    </article>
  );
}

/** Recebimento de pedido fora de mesa (balcão, retirada, entrega). Só para quem mexe no caixa. */
function OrderPayment({ order }: { order: Order }) {
  const { db, store, role } = usePainel();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  if (role !== "owner" && role !== "manager" && role !== "cashier") return null;
  const payments = (db.payments ?? []).filter((p) => p.orderId === order.id);
  const paid = orderPaid(order, payments);
  const due = orderDue(order, payments);
  const cashOpen = Boolean(openSession(db.cashSessions ?? [], store.id));
  if (order.status === "cancelado" && !paid) return null;

  async function pay(input: PayInput) {
    const result = await attempt(toast, () => registerPayment({ orderId: order.id, ...input }));
    if (!result) return false;
    toast(result.payment.changeGiven > 0 ? `Recebido. Troco: ${formatMoney(result.payment.changeGiven)}` : "Recebido");
    if (result.due === 0) setOpen(false);
    return true;
  }

  return (
    <div className="no-print mt-3 rounded-card border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{due > 0 ? (paid > 0 ? `Falta receber ${formatMoney(due)}` : "A receber") : "Pagamento"}</span>
        {due <= 0 ? <Pill tone="positive">Pago</Pill> : !open && cashOpen && (
          <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
            Receber {formatMoney(due)}
          </Button>
        )}
      </div>
      {payments.length > 0 && (
        <div className="mt-2">
          <PaymentList payments={payments} />
        </div>
      )}
      {due > 0 && !cashOpen && (
        <div className="mt-2">
          <CashClosedNotice />
        </div>
      )}
      {due > 0 && open && cashOpen && (
        <div className="mt-3">
          <PaymentForm key={due} due={due} onPay={pay} />
        </div>
      )}
    </div>
  );
}
