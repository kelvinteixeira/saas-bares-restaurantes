import type { CashMovement, CashSession, Order, Payment, PaymentKind, Tab } from "@/lib/types";
import { tabTotals } from "@/lib/domain/tabs";

// Regras do caixa. O banco (SQL 005) aplica as mesmas: conta da mesa e pedido recebem em partes,
// em várias formas; no dinheiro o troco é calculado; o fechamento compara contado com esperado.

export const PAYMENT_KINDS: PaymentKind[] = ["pix", "credit", "debit", "cash"];

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  pix: "Pix",
  credit: "Crédito",
  debit: "Débito",
  cash: "Dinheiro",
};

export function openSession(sessions: CashSession[], storeId: string): CashSession | undefined {
  return sessions.find((s) => s.storeId === storeId && s.status === "open");
}

const paidBy = (payments: Payment[], match: (p: Payment) => boolean) => payments.filter(match).reduce((sum, p) => sum + p.amount, 0);

export function tabPaid(tab: Pick<Tab, "id">, payments: Payment[]): number {
  return paidBy(payments, (p) => p.tabId === tab.id);
}

/** Quanto falta receber da conta da mesa (consumo + taxa − pagamentos). */
export function tabDue(tab: Pick<Tab, "id" | "serviceFeeRate" | "serviceFeeRemoved">, orders: Order[], payments: Payment[]): number {
  return tabTotals(tab, orders).total - tabPaid(tab, payments);
}

export function orderPaid(order: Pick<Order, "id">, payments: Payment[]): number {
  return paidBy(payments, (p) => p.orderId === order.id);
}

/** Quanto falta receber de um pedido fora de mesa (cancelado não deve nada). */
export function orderDue(order: Pick<Order, "id" | "total" | "status">, payments: Payment[]): number {
  return (order.status === "cancelado" ? 0 : order.total) - orderPaid(order, payments);
}

/** Dinheiro entregue pelo cliente: abate até o que falta e o resto é troco. */
export function cashSplit(due: number, received: number): { amount: number; change: number } {
  const amount = Math.max(0, Math.min(received, due));
  return { amount, change: Math.max(0, received - amount) };
}

export interface SessionSummary {
  /** Total recebido por forma. */
  byMethod: Record<PaymentKind, number>;
  received: number;
  changeGiven: number;
  deposits: number;
  withdrawals: number;
  /** Dinheiro que deveria estar na gaveta: fundo + dinheiro recebido + suprimentos − sangrias. */
  expectedCash: number;
  count: number;
}

export function sessionSummary(session: CashSession, payments: Payment[], movements: CashMovement[]): SessionSummary {
  const mine = payments.filter((p) => p.cashSessionId === session.id);
  const moves = movements.filter((m) => m.cashSessionId === session.id);
  const byMethod: Record<PaymentKind, number> = { pix: 0, credit: 0, debit: 0, cash: 0 };
  for (const p of mine) byMethod[p.method] += p.amount;
  const deposits = moves.filter((m) => m.kind === "deposit").reduce((s, m) => s + m.amount, 0);
  const withdrawals = moves.filter((m) => m.kind === "withdrawal").reduce((s, m) => s + m.amount, 0);
  return {
    byMethod,
    received: mine.reduce((s, p) => s + p.amount, 0),
    changeGiven: mine.reduce((s, p) => s + p.changeGiven, 0),
    deposits,
    withdrawals,
    expectedCash: session.openingAmount + byMethod.cash + deposits - withdrawals,
    count: mine.length,
  };
}
