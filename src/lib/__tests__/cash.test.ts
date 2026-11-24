import { describe, expect, it } from "vitest";
import type { CashMovement, CashSession, Order, Payment, Tab } from "@/lib/types";
import { cashSplit, orderDue, sessionSummary, tabDue } from "@/lib/domain/cash";

const tab: Tab = { id: "t", storeId: "s", tableNumber: 1, status: "open", openedAt: "", serviceFeeRate: 10, serviceFeeRemoved: false };
const order = (over: Partial<Order>): Order =>
  ({ id: "o", storeId: "s", number: 1, createdAt: "", promisedAt: "", status: "novo", history: [], mode: "table", customer: { name: "", phone: "" }, items: [], subtotal: 0, deliveryFee: 0, total: 0, payment: { method: "tab" }, ...over }) as Order;
const pay = (over: Partial<Payment>): Payment => ({ id: Math.random().toString(), storeId: "s", cashSessionId: "c", method: "pix", amount: 0, changeGiven: 0, createdAt: "", ...over });

describe("caixa", () => {
  it("conta da mesa: consumo + 10% − o que já foi pago", () => {
    const orders = [order({ id: "a", tabId: "t", subtotal: 8500 }), order({ id: "b", tabId: "t", subtotal: 1000, status: "cancelado" })];
    expect(tabDue(tab, orders, [])).toBe(9350);
    expect(tabDue(tab, orders, [pay({ tabId: "t", amount: 3000 }), pay({ tabId: "t", amount: 2350, method: "credit" })])).toBe(4000);
    expect(tabDue({ ...tab, serviceFeeRemoved: true }, orders, [])).toBe(8500);
  });

  it("pedido fora de mesa: total − pagamentos; cancelado não deve nada", () => {
    expect(orderDue(order({ total: 4700 }), [pay({ orderId: "o", amount: 4700 })])).toBe(0);
    expect(orderDue(order({ total: 4700 }), [])).toBe(4700);
    expect(orderDue(order({ total: 4700, status: "cancelado" }), [])).toBe(0);
  });

  it("dinheiro: abate até o que falta e calcula o troco; pagamento parcial sem troco", () => {
    expect(cashSplit(4000, 5000)).toEqual({ amount: 4000, change: 1000 });
    expect(cashSplit(4000, 1500)).toEqual({ amount: 1500, change: 0 });
    expect(cashSplit(4000, 4000)).toEqual({ amount: 4000, change: 0 });
  });

  it("fechamento: esperado em dinheiro = fundo + dinheiro recebido + suprimentos − sangrias", () => {
    const session: CashSession = { id: "c", storeId: "s", status: "open", openedAt: "", openingAmount: 10000 };
    const payments = [
      pay({ method: "pix", amount: 3000 }),
      pay({ method: "credit", amount: 2350 }),
      pay({ method: "cash", amount: 4000, changeGiven: 1000 }),
      pay({ method: "cash", amount: 4250, changeGiven: 5750 }),
      pay({ method: "pix", amount: 999, cashSessionId: "outro-turno" }),
    ];
    const moves: CashMovement[] = [
      { id: "1", storeId: "s", cashSessionId: "c", kind: "withdrawal", amount: 5000, reason: "banco", createdAt: "" },
      { id: "2", storeId: "s", cashSessionId: "c", kind: "deposit", amount: 2000, reason: "troco", createdAt: "" },
    ];
    const s = sessionSummary(session, payments, moves);
    expect(s.byMethod).toEqual({ pix: 3000, credit: 2350, debit: 0, cash: 8250 });
    expect(s.received).toBe(13600);
    expect(s.changeGiven).toBe(6750);
    expect(s.expectedCash).toBe(15250);
    expect(s.count).toBe(4);
  });
});
