import type { Order, OrderMode, Payment, PaymentKind, Tab } from "@/lib/types";
import { orderDue, tabDue } from "@/lib/domain/cash";
import { tabTotals } from "@/lib/domain/tabs";
import { topProducts, type TopProduct } from "@/lib/domain/stats";

// Relatório de vendas de um período: o que foi vendido (pedidos), o que entrou no caixa
// (pagamentos), a taxa de serviço das mesas fechadas e os itens mais vendidos.

export type Period = "hoje" | "ontem" | "7dias";

export const PERIOD_LABEL: Record<Period, string> = { hoje: "Hoje", ontem: "Ontem", "7dias": "Últimos 7 dias" };

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Intervalo [from, to) do período, no horário do aparelho. */
export function periodRange(period: Period, now: Date): { from: Date; to: Date } {
  const today = startOfDay(now);
  if (period === "hoje") return { from: today, to: now };
  if (period === "ontem") return { from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1), to: today };
  return { from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6), to: now };
}

const inRange = (iso: string | undefined, from: Date, to: Date) => {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
};

export interface ChannelLine {
  count: number;
  revenue: number;
}

export interface DayLine {
  day: Date;
  count: number;
  revenue: number;
}

export interface SalesReport {
  /** Pedidos válidos (não cancelados) do período. */
  orders: Order[];
  count: number;
  /** Soma dos pedidos (itens + entrega), sem a taxa de serviço. */
  revenue: number;
  ticket: number;
  cancelled: ChannelLine;
  byMode: Record<OrderMode, ChannelLine>;
  /** Taxa de serviço das mesas fechadas no período. */
  serviceFee: number;
  tabsClosed: number;
  /** Mesas em que o cliente pediu para tirar a taxa. */
  feeRemoved: number;
  /** Pagamentos registrados no caixa no período, por forma. */
  received: Record<PaymentKind, number>;
  receivedTotal: number;
  changeGiven: number;
  /** Vendas do período ainda sem pagamento registrado (pedidos fora de mesa e mesas abertas). */
  pending: number;
  top: TopProduct[];
  byDay: DayLine[];
}

export function salesReport(
  input: { storeId: string; orders: Order[]; tabs: Tab[]; payments: Payment[] },
  from: Date,
  to: Date,
): SalesReport {
  const mine = input.orders.filter((o) => o.storeId === input.storeId && inRange(o.createdAt, from, to));
  const valid = mine.filter((o) => o.status !== "cancelado");
  const cancelledList = mine.filter((o) => o.status === "cancelado");
  const revenue = valid.reduce((s, o) => s + o.total, 0);

  const byMode: Record<OrderMode, ChannelLine> = {
    delivery: { count: 0, revenue: 0 },
    pickup: { count: 0, revenue: 0 },
    table: { count: 0, revenue: 0 },
  };
  for (const o of valid) {
    byMode[o.mode].count += 1;
    byMode[o.mode].revenue += o.total;
  }

  const tabs = input.tabs.filter((t) => t.storeId === input.storeId);
  const closed = tabs.filter((t) => t.status === "closed" && inRange(t.closedAt, from, to));
  const serviceFee = closed.reduce((s, t) => s + tabTotals(t, input.orders).fee, 0);

  const payments = input.payments.filter((p) => p.storeId === input.storeId && inRange(p.createdAt, from, to));
  const received: Record<PaymentKind, number> = { pix: 0, credit: 0, debit: 0, cash: 0 };
  for (const p of payments) received[p.method] += p.amount;

  // Falta receber: pedidos do período fora de mesa e as mesas ainda abertas que têm pedidos do período.
  const pendingOrders = valid.filter((o) => !o.tabId).reduce((s, o) => s + Math.max(0, orderDue(o, input.payments)), 0);
  const openTabIds = new Set(valid.filter((o) => o.tabId).map((o) => o.tabId!));
  const pendingTabs = tabs
    .filter((t) => t.status !== "closed" && openTabIds.has(t.id))
    .reduce((s, t) => s + Math.max(0, tabDue(t, input.orders, input.payments)), 0);

  const byDay: DayLine[] = [];
  for (let d = startOfDay(from); d < to; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const list = valid.filter((o) => inRange(o.createdAt, d, next));
    byDay.push({ day: d, count: list.length, revenue: list.reduce((s, o) => s + o.total, 0) });
  }

  return {
    orders: valid,
    count: valid.length,
    revenue,
    ticket: valid.length ? Math.round(revenue / valid.length) : 0,
    cancelled: { count: cancelledList.length, revenue: cancelledList.reduce((s, o) => s + o.total, 0) },
    byMode,
    serviceFee,
    tabsClosed: closed.length,
    feeRemoved: closed.filter((t) => t.serviceFeeRemoved && t.serviceFeeRate > 0).length,
    received,
    receivedTotal: payments.reduce((s, p) => s + p.amount, 0),
    changeGiven: payments.reduce((s, p) => s + p.changeGiven, 0),
    pending: pendingOrders + pendingTabs,
    top: topProducts(valid, 10),
    byDay,
  };
}

const MODE_CSV: Record<OrderMode, string> = { delivery: "Entrega", pickup: "Retirada/Balcão", table: "Mesa" };
const SOURCE_CSV = { cliente: "Cliente", garcom: "Garçom", pdv: "PDV" } as const;

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const money = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Planilha dos pedidos (separador ";" e vírgula decimal, como o Excel em português abre). */
export function ordersCsv(orders: Order[]): string {
  const header = ["Número", "Data", "Hora", "Canal", "Mesa", "Cliente", "Itens", "Subtotal", "Entrega", "Total", "Status", "Origem"];
  const rows = [...orders]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((o) => {
      const at = new Date(o.createdAt);
      return [
        o.number,
        at.toLocaleDateString("pt-BR"),
        at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        MODE_CSV[o.mode],
        o.tableNumber ?? "",
        o.customer.name,
        o.items.map((i) => `${i.quantity}x ${i.name}`).join(", "),
        money(o.subtotal),
        money(o.deliveryFee),
        money(o.total),
        o.status,
        SOURCE_CSV[o.source ?? "cliente"],
      ];
    });
  return [header, ...rows].map((r) => r.map(csvCell).join(";")).join("\r\n");
}
