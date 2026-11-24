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

const { getDb, mutate, resetCacheForTests } = await import("@/lib/store/db");
const { placeOrder } = await import("@/lib/store/actions");
const { addToTab, closeTab, openTab, requestBill, transferTab, TabError } = await import("@/lib/store/tabs");
const { tabTotals } = await import("@/lib/domain/tabs");
const { DEMO_STORE_ID } = await import("@/lib/seed");

const batata = { key: "b", productId: "p-batata", selections: { "g-batata-tam": ["o-inteira"] }, quantity: 1 };
const cerveja = { key: "c", productId: "p-cerveja", selections: { "g-cerveja-marca": ["o-pilsen"] }, quantity: 2 };

// Mesas livres na demonstração (a demo já vem com mesas ocupadas).
function freeTables(): number[] {
  const db = getDb();
  const busy = new Set((db.tabs ?? []).filter((t) => t.status !== "closed").map((t) => t.tableNumber));
  const count = db.stores.find((s) => s.id === DEMO_STORE_ID)!.table.count;
  return Array.from({ length: count }, (_, i) => i + 1).filter((n) => !busy.has(n));
}

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
  mutate((db) => {
    db.stores.find((s) => s.id === DEMO_STORE_ID)!.manualStatus = "open";
  });
});

describe("comanda na loja local", () => {
  it("garçom lança na mesa livre: abre a comanda e o pedido vai para a cozinha", async () => {
    const [table] = freeTables();
    const order = await addToTab(DEMO_STORE_ID, table, [batata, cerveja], "sem cebola");
    const tab = getDb().tabs!.find((t) => t.id === order.tabId)!;
    expect(tab).toMatchObject({ tableNumber: table, status: "open", serviceFeeRate: 10 });
    expect(order).toMatchObject({ source: "garcom", mode: "table", status: "novo", payment: { method: "tab" }, notes: "sem cebola" });
    expect(order.customer.name).toBe(`Mesa ${table}`);
    expect(order.subtotal).toBeGreaterThan(0);
  });

  it("pedido do cliente pelo QR entra na mesma comanda do garçom", async () => {
    const [table] = freeTables();
    const byWaiter = await addToTab(DEMO_STORE_ID, table, [batata]);
    const byClient = await placeOrder({
      storeId: DEMO_STORE_ID,
      mode: "table",
      tableNumber: table,
      lines: [cerveja],
      customer: { name: "Ana", phone: "" },
      payment: { method: "pix" },
    });
    expect(byClient.tabId).toBe(byWaiter.tabId);
    const tab = getDb().tabs!.find((t) => t.id === byWaiter.tabId)!;
    expect(tabTotals(tab, getDb().orders).consumption).toBe(byWaiter.subtotal + byClient.subtotal);
  });

  it("dois garçons abrindo a mesma mesa recebem a mesma comanda", async () => {
    const [table] = freeTables();
    const a = await openTab(DEMO_STORE_ID, table);
    const b = await openTab(DEMO_STORE_ID, table);
    expect(b.id).toBe(a.id);
    await expect(openTab(DEMO_STORE_ID, 999)).rejects.toThrow(TabError);
  });

  it("pedir a conta e lançar de novo reabre a mesa", async () => {
    const [table] = freeTables();
    const order = await addToTab(DEMO_STORE_ID, table, [batata]);
    await requestBill(order.tabId!);
    expect(getDb().tabs!.find((t) => t.id === order.tabId)!.status).toBe("bill_requested");
    await addToTab(DEMO_STORE_ID, table, [cerveja]);
    expect(getDb().tabs!.find((t) => t.id === order.tabId)!.status).toBe("open");
  });

  it("troca de mesa só para mesa livre, levando os pedidos", async () => {
    const [from, to, other] = freeTables();
    const order = await addToTab(DEMO_STORE_ID, from, [batata]);
    await addToTab(DEMO_STORE_ID, other, [batata]);
    await expect(transferTab(order.tabId!, other)).rejects.toThrow("ocupada");
    await transferTab(order.tabId!, to);
    const moved = getDb().orders.find((o) => o.id === order.id)!;
    expect(moved.tableNumber).toBe(to);
    expect(moved.customer.name).toBe(`Mesa ${to}`);
  });

  it("fechar a conta só com ela paga; mesa vazia fecha direto", async () => {
    const [table, empty] = freeTables();
    const order = await addToTab(DEMO_STORE_ID, table, [batata]);
    await expect(closeTab(order.tabId!)).rejects.toThrow("Ainda falta receber");
    const tab = await openTab(DEMO_STORE_ID, empty);
    await closeTab(tab.id);
    expect(getDb().tabs!.find((t) => t.id === tab.id)!.status).toBe("closed");
    expect(freeTables()).toContain(empty);
  });

  it("recusa item sem a escolha obrigatória e lançamento vazio", async () => {
    const [table] = freeTables();
    await expect(addToTab(DEMO_STORE_ID, table, [{ key: "x", productId: "p-batata", selections: {}, quantity: 1 }])).rejects.toThrow();
    await expect(addToTab(DEMO_STORE_ID, table, [])).rejects.toThrow(TabError);
    expect((getDb().tabs ?? []).some((t) => t.tableNumber === table && t.status !== "closed")).toBe(false);
  });
});
