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
const { pdvOrder, PdvError } = await import("@/lib/store/pdv");
const { DEMO_STORE_ID } = await import("@/lib/seed");

type Input = Parameters<typeof pdvOrder>[0];
const isca = { key: "i", productId: "p-isca", selections: {}, quantity: 1 };
const base = (over: Partial<Input> = {}): Input => ({
  storeId: DEMO_STORE_ID,
  mode: "pickup",
  lines: [isca],
  customer: { name: "", phone: "" },
  payment: { method: "card" },
  ...over,
});

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
  // Loja fechada e Pix desligado: o PDV lança mesmo assim.
  mutate((db) => {
    const s = db.stores.find((x) => x.id === DEMO_STORE_ID)!;
    s.manualStatus = "closed";
    s.payment.pix = false;
  });
});

describe("PDV na loja local", () => {
  it("balcão sem nome vira Balcão, com a loja fechada e qualquer pagamento", async () => {
    const o = await pdvOrder(base({ payment: { method: "pix" } }));
    expect(o).toMatchObject({ source: "pdv", mode: "pickup", customer: { name: "Balcão", phone: "" }, payment: { method: "pix" }, total: 4200 });
    expect(o.tabId).toBeUndefined();
  });

  it("entrega exige nome, telefone, bairro ativo, rua e número, e cobra a taxa", async () => {
    const delivery = { regionId: "r-centro", street: "Rua A", number: "10" };
    const ok = await pdvOrder(base({ mode: "delivery", customer: { name: "Ana", phone: "(81) 98888-7777" }, delivery }));
    expect(ok.deliveryFee).toBe(500);
    expect(ok.customer.phone).toBe("81988887777");
    await expect(pdvOrder(base({ mode: "delivery", customer: { name: "Ana", phone: "" }, delivery }))).rejects.toThrow("telefone");
    await expect(pdvOrder(base({ mode: "delivery", customer: { name: "", phone: "81988887777" }, delivery }))).rejects.toThrow("nome");
    await expect(pdvOrder(base({ mode: "delivery", customer: { name: "Ana", phone: "81988887777" }, delivery: { ...delivery, regionId: "r-ilha" } }))).rejects.toThrow("bairro");
  });

  it("mesa vai para a conta da mesa e entra na comanda", async () => {
    const a = await pdvOrder(base({ mode: "table", tableNumber: 11 }));
    const b = await pdvOrder(base({ mode: "table", tableNumber: 11 }));
    expect(a.payment.method).toBe("tab");
    expect(a.customer.name).toBe("Mesa 11");
    expect(b.tabId).toBe(a.tabId);
    expect(getDb().tabs!.find((t) => t.id === a.tabId)!.tableNumber).toBe(11);
    await expect(pdvOrder(base({ mode: "table", tableNumber: 99 }))).rejects.toThrow(PdvError);
  });

  it("recusa telefone incompleto, troco menor e pedido vazio, sem gastar número", async () => {
    const before = getDb().stores.find((s) => s.id === DEMO_STORE_ID)!.nextOrderNumber;
    await expect(pdvOrder(base({ customer: { name: "", phone: "123" } }))).rejects.toThrow("DDD");
    await expect(pdvOrder(base({ payment: { method: "cash", changeFor: 1000 } }))).rejects.toThrow("troco");
    await expect(pdvOrder(base({ lines: [] }))).rejects.toThrow(PdvError);
    expect(getDb().stores.find((s) => s.id === DEMO_STORE_ID)!.nextOrderNumber).toBe(before);
    expect((await pdvOrder(base({ payment: { method: "cash", changeFor: 5000 } }))).payment.changeFor).toBe(5000);
  });
});
