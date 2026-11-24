import { beforeEach, describe, expect, it } from "vitest";

// O "banco" local usa window.localStorage; aqui um substituto em memória.
const memory = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
};

const { getDb, resetCacheForTests } = await import("@/lib/store/db");
const { addToTab } = await import("@/lib/store/tabs");
const { pdvOrder } = await import("@/lib/store/pdv");
const { openCash, closeCash, cashMovement, registerPayment, setTabServiceFee, CashError } = await import("@/lib/store/cash");
const { tabDue, sessionSummary, openSession } = await import("@/lib/domain/cash");
const { DEMO_STORE_ID } = await import("@/lib/seed");

const isca = { key: "i", productId: "p-isca", selections: {}, quantity: 2 }; // 2 × 42,00 = 84,00

function freeTable(): number {
  const db = getDb();
  const busy = new Set((db.tabs ?? []).filter((t) => t.status !== "closed").map((t) => t.tableNumber));
  return Array.from({ length: 12 }, (_, i) => i + 1).find((n) => !busy.has(n))!;
}

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
});

describe("caixa na loja local", () => {
  it("sem caixa aberto não recebe; não abre dois", async () => {
    const order = await addToTab(DEMO_STORE_ID, freeTable(), [isca]);
    await expect(registerPayment({ tabId: order.tabId, method: "pix", amount: 100 })).rejects.toThrow("Abra o caixa");
    await openCash(DEMO_STORE_ID, 10000);
    await expect(openCash(DEMO_STORE_ID, 0)).rejects.toThrow("já está aberto");
  });

  it("conta da mesa em partes: Pix, crédito e dinheiro com troco; zera e fecha a mesa", async () => {
    await openCash(DEMO_STORE_ID, 10000);
    const order = await addToTab(DEMO_STORE_ID, freeTable(), [isca]); // 8400 + 10% = 9240
    const tabId = order.tabId!;
    await expect(registerPayment({ tabId, method: "pix", amount: 99999 })).rejects.toThrow("92,40");
    expect((await registerPayment({ tabId, method: "pix", amount: 3000 })).due).toBe(6240);
    expect((await registerPayment({ tabId, method: "credit", amount: 2240 })).due).toBe(4000);
    const last = await registerPayment({ tabId, method: "cash", received: 5000 });
    expect(last).toMatchObject({ due: 0, tabClosed: true, payment: { amount: 4000, changeGiven: 1000 } });
    expect(getDb().tabs!.find((t) => t.id === tabId)!.status).toBe("closed");
    expect(getDb().orders.find((o) => o.id === order.id)!.status).toBe("concluido");
    await expect(registerPayment({ tabId, method: "pix", amount: 1 })).rejects.toThrow(CashError);
  });

  it("tirar a taxa antes de receber; não tira se já recebeu mais que o total sem ela", async () => {
    await openCash(DEMO_STORE_ID, 0);
    const a = await addToTab(DEMO_STORE_ID, freeTable(), [isca]);
    await setTabServiceFee(a.tabId!, true);
    const tabA = getDb().tabs!.find((t) => t.id === a.tabId)!;
    expect(tabDue(tabA, getDb().orders, getDb().payments ?? [])).toBe(8400);
    const b = await addToTab(DEMO_STORE_ID, freeTable(), [isca]);
    await registerPayment({ tabId: b.tabId, method: "pix", amount: 9000 });
    await expect(setTabServiceFee(b.tabId!, true)).rejects.toThrow("Já foi recebido");
  });

  it("pedido de balcão recebe pelo pedido; pedido de mesa, pela comanda", async () => {
    await openCash(DEMO_STORE_ID, 0);
    const balcao = await pdvOrder({ storeId: DEMO_STORE_ID, mode: "pickup", lines: [isca], customer: { name: "", phone: "" }, payment: { method: "cash" } });
    const r = await registerPayment({ orderId: balcao.id, method: "cash", received: 10000 });
    expect(r).toMatchObject({ due: 0, tabClosed: false, payment: { amount: 8400, changeGiven: 1600 } });
    const mesa = await addToTab(DEMO_STORE_ID, freeTable(), [isca]);
    await expect(registerPayment({ orderId: mesa.id, method: "pix", amount: 100 })).rejects.toThrow("conta da mesa");
  });

  it("sangria, suprimento e fechamento com esperado e contado", async () => {
    await openCash(DEMO_STORE_ID, 10000);
    const balcao = await pdvOrder({ storeId: DEMO_STORE_ID, mode: "pickup", lines: [isca], customer: { name: "", phone: "" }, payment: { method: "cash" } });
    await registerPayment({ orderId: balcao.id, method: "cash", received: 10000 }); // entra 84,00 líquido
    await expect(cashMovement(DEMO_STORE_ID, "withdrawal", 999999, "banco")).rejects.toThrow("Não há");
    await expect(cashMovement(DEMO_STORE_ID, "deposit", 100, " ")).rejects.toThrow("motivo");
    await cashMovement(DEMO_STORE_ID, "withdrawal", 5000, "Banco");
    await cashMovement(DEMO_STORE_ID, "deposit", 2000, "Troco");
    const s = openSession(getDb().cashSessions ?? [], DEMO_STORE_ID)!;
    expect(sessionSummary(s, getDb().payments ?? [], getDb().cashMovements ?? []).expectedCash).toBe(15400);
    const closed = await closeCash(DEMO_STORE_ID, 15000, "faltou moeda");
    expect(closed).toMatchObject({ status: "closed", expectedAmount: 15400, countedAmount: 15000, notes: "faltou moeda" });
    await expect(closeCash(DEMO_STORE_ID, 0)).rejects.toThrow("já está fechado");
  });
});
