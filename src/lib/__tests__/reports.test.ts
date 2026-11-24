import { describe, expect, it } from "vitest";
import type { Order, Payment, Tab } from "@/lib/types";
import { ordersCsv, periodRange, salesReport } from "@/lib/domain/reports";

const now = new Date(2026, 10, 24, 21, 0); // 24/11, 21h (horário do aparelho)
const at = (day: number, hour: number) => new Date(2026, 10, day, hour, 0).toISOString();

function order(over: Partial<Order>): Order {
  return {
    id: Math.random().toString(36).slice(2),
    storeId: "s",
    number: 1,
    createdAt: at(24, 12),
    promisedAt: at(24, 13),
    status: "concluido",
    history: [],
    mode: "pickup",
    customer: { name: "Ana", phone: "" },
    items: [{ productId: "isca", name: "Isca", unitPrice: 4200, quantity: 1, options: [] }],
    subtotal: 4200,
    deliveryFee: 0,
    total: 4200,
    payment: { method: "pix" },
    ...over,
  };
}
const pay = (over: Partial<Payment>): Payment => ({ id: Math.random().toString(), storeId: "s", cashSessionId: "c", method: "pix", amount: 0, changeGiven: 0, createdAt: at(24, 15), ...over });

describe("relatórios", () => {
  it("períodos: hoje, ontem e 7 dias", () => {
    expect(periodRange("hoje", now).from).toEqual(new Date(2026, 10, 24));
    expect(periodRange("ontem", now)).toEqual({ from: new Date(2026, 10, 23), to: new Date(2026, 10, 24) });
    expect(periodRange("7dias", now).from).toEqual(new Date(2026, 10, 18));
  });

  it("vendas por canal, cancelados à parte, taxa das mesas fechadas e o que entrou no caixa", () => {
    const tabA: Tab = { id: "ta", storeId: "s", tableNumber: 1, status: "closed", openedAt: at(24, 19), closedAt: at(24, 20), serviceFeeRate: 10, serviceFeeRemoved: false };
    const tabB: Tab = { id: "tb", storeId: "s", tableNumber: 2, status: "closed", openedAt: at(24, 19), closedAt: at(24, 20), serviceFeeRate: 10, serviceFeeRemoved: true };
    const tabC: Tab = { id: "tc", storeId: "s", tableNumber: 3, status: "open", openedAt: at(24, 20), serviceFeeRate: 10, serviceFeeRemoved: false };
    const orders = [
      order({ mode: "delivery", subtotal: 3600, deliveryFee: 700, total: 4300 }),
      order({ mode: "pickup", total: 4200 }),
      order({ mode: "table", tabId: "ta", subtotal: 8400, total: 8400, items: [{ productId: "isca", name: "Isca", unitPrice: 4200, quantity: 2, options: [] }] }),
      order({ mode: "table", tabId: "tb", subtotal: 4200, total: 4200 }),
      order({ mode: "table", tabId: "tc", subtotal: 1000, total: 1000, status: "novo", items: [{ productId: "refri", name: "Refri", unitPrice: 1000, quantity: 1, options: [] }] }),
      order({ mode: "pickup", total: 9999, status: "cancelado" }),
      order({ mode: "pickup", total: 5000, createdAt: at(23, 12) }), // ontem: fora de "hoje"
      order({ storeId: "outra", total: 7777 }),
    ];
    const payments = [
      pay({ orderId: orders[0].id, method: "cash", amount: 4300, changeGiven: 700 }),
      pay({ tabId: "ta", method: "credit", amount: 9240 }),
      pay({ tabId: "tb", method: "debit", amount: 4200 }),
    ];
    const { from, to } = periodRange("hoje", now);
    const r = salesReport({ storeId: "s", orders, tabs: [tabA, tabB, tabC], payments }, from, to);
    expect(r.count).toBe(5);
    expect(r.revenue).toBe(4300 + 4200 + 8400 + 4200 + 1000);
    expect(r.ticket).toBe(Math.round(22100 / 5));
    expect(r.cancelled).toEqual({ count: 1, revenue: 9999 });
    expect(r.byMode).toEqual({ delivery: { count: 1, revenue: 4300 }, pickup: { count: 1, revenue: 4200 }, table: { count: 3, revenue: 13600 } });
    expect(r.serviceFee).toBe(840); // só a mesa 1; a 2 tirou a taxa
    expect(r.tabsClosed).toBe(2);
    expect(r.feeRemoved).toBe(1);
    expect(r.received).toEqual({ pix: 0, credit: 9240, debit: 4200, cash: 4300 });
    expect(r.receivedTotal).toBe(17740);
    expect(r.changeGiven).toBe(700);
    expect(r.pending).toBe(4200 + 1100); // balcão sem pagamento + mesa 3 aberta (1000 + 10%)
    expect(r.top[0]).toMatchObject({ name: "Isca", quantity: 5 });
  });

  it("7 dias: uma linha por dia", () => {
    const { from, to } = periodRange("7dias", now);
    const r = salesReport({ storeId: "s", orders: [order({}), order({ createdAt: at(20, 12) })], tabs: [], payments: [] }, from, to);
    expect(r.byDay).toHaveLength(7);
    expect(r.byDay.find((d) => d.day.getDate() === 20)!.count).toBe(1);
    expect(r.byDay.at(-1)!.count).toBe(1);
  });

  it("planilha com ponto e vírgula, vírgula decimal e aspas quando precisa", () => {
    const csv = ordersCsv([order({ number: 7, customer: { name: 'Zé "do bar"; mesa', phone: "" }, total: 12345 })]);
    const [head, row] = csv.split("\r\n");
    expect(head.startsWith("Número;Data;Hora;Canal")).toBe(true);
    expect(row).toContain('"Zé ""do bar""; mesa"');
    expect(row).toContain(";123,45;");
  });
});
