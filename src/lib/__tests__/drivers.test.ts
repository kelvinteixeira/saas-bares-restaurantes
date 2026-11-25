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
const { placeOrder, cancelOrder } = await import("@/lib/store/actions");
const { assignDriver, deleteDriver, newDriver, saveDriver, DriverError } = await import("@/lib/store/drivers");
const { dispatchLink, settlements } = await import("@/lib/domain/drivers");
const { DEMO_STORE_ID } = await import("@/lib/seed");

type Input = Parameters<typeof placeOrder>[0];
const delivery = (over: Partial<Input> = {}): Input => ({
  storeId: DEMO_STORE_ID,
  mode: "delivery",
  lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 1 }],
  delivery: { regionId: "r-centro", street: "Rua A", number: "10", reference: "Portão azul" },
  customer: { name: "Ana", phone: "81999990000" },
  payment: { method: "cash", changeFor: 5000 },
  ...over,
});
const day = () => {
  const now = new Date();
  return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: new Date(now.getTime() + 60_000) };
};

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
  mutate((db) => {
    db.stores.find((s) => s.id === DEMO_STORE_ID)!.manualStatus = "open";
  });
});

describe("entregadores", () => {
  it("cadastra com validação e escolhe no pedido: taxa da entrega ou valor fixo", async () => {
    await expect(saveDriver({ ...newDriver(DEMO_STORE_ID), name: " " })).rejects.toThrow(DriverError);
    await expect(saveDriver({ ...newDriver(DEMO_STORE_ID), name: "Zé", phone: "123" })).rejects.toThrow("DDD");
    const ze = await saveDriver({ ...newDriver(DEMO_STORE_ID), name: "Zé", phone: "(81) 91111-2222" });
    expect(ze.phone).toBe("81911112222");
    const bia = await saveDriver({ ...newDriver(DEMO_STORE_ID), name: "Bia", payKind: "fixed", payAmount: 800 });

    const o = await placeOrder(delivery()); // taxa do Centro: R$ 5,00
    await assignDriver(o.id, ze.id);
    expect(getDb().orders.find((x) => x.id === o.id)).toMatchObject({ driverId: ze.id, driverPay: 500 });
    await assignDriver(o.id, bia.id);
    expect(getDb().orders.find((x) => x.id === o.id)!.driverPay).toBe(800);
    await assignDriver(o.id, null);
    expect(getDb().orders.find((x) => x.id === o.id)!.driverId).toBeUndefined();
  });

  it("recusa retirada, pedido cancelado e entregador desativado", async () => {
    const ze = await saveDriver({ ...newDriver(DEMO_STORE_ID), name: "Zé" });
    const pickup = await placeOrder(delivery({ mode: "pickup", delivery: undefined, payment: { method: "pix" } }));
    await expect(assignDriver(pickup.id, ze.id)).rejects.toThrow("Só pedido de entrega");
    await saveDriver({ ...ze, active: false });
    const o = await placeOrder(delivery());
    await expect(assignDriver(o.id, ze.id)).rejects.toThrow("desativado");
    await cancelOrder(o.id);
    await expect(assignDriver(o.id, null)).rejects.toThrow("cancelado");
  });

  it("acerto do dia: entregas, valor a pagar e dinheiro que o entregador traz", async () => {
    const ze = await saveDriver({ ...newDriver(DEMO_STORE_ID), name: "Zé" });
    const a = await placeOrder(delivery());
    const b = await placeOrder(delivery({ payment: { method: "pix" } }));
    const c = await placeOrder(delivery());
    for (const o of [a, b, c]) await assignDriver(o.id, ze.id);
    await cancelOrder(c.id);
    const { from, to } = day();
    const [s] = settlements(getDb().drivers ?? [], getDb().orders, DEMO_STORE_ID, from, to);
    expect(s.driver?.name).toBe("Zé");
    expect(s.orders).toHaveLength(2);
    expect(s.pay).toBe(1000);
    expect(s.cash).toBe(a.total);
    await deleteDriver(ze);
    expect(getDb().orders.find((x) => x.id === a.id)!.driverId).toBeUndefined();
  });

  it("mensagem do WhatsApp com endereço, cobrança e mapa", () => {
    const order = {
      id: "o",
      storeId: "s",
      number: 12,
      createdAt: "",
      promisedAt: "",
      status: "pronto" as const,
      history: [],
      mode: "delivery" as const,
      customer: { name: "Ana", phone: "81999990000" },
      delivery: { regionId: "r", regionName: "Centro", street: "Rua A", number: "10", reference: "Portão azul" },
      items: [],
      subtotal: 4200,
      deliveryFee: 500,
      total: 4700,
      payment: { method: "cash" as const, changeFor: 5000 },
    };
    const url = dispatchLink(order, { name: "Bar" }, { name: "Zé", phone: "81911112222" });
    expect(url.startsWith("https://wa.me/5581911112222?text=")).toBe(true);
    const text = decodeURIComponent(url.split("text=")[1]);
    expect(text).toContain("Rua A, 10 · Centro");
    expect(text).toContain("Portão azul");
    expect(text).toContain("dinheiro");
    expect(text).toContain("troco para");
    expect(text).toContain("google.com/maps");
    const paid = decodeURIComponent(dispatchLink(order, { name: "Bar" }, { name: "Zé", phone: "" }, 0).split("text=")[1]);
    expect(paid).toContain("não cobrar");
    const pix = decodeURIComponent(dispatchLink({ ...order, payment: { method: "pix" } }, { name: "Bar" }, { name: "Zé", phone: "" }).split("text=")[1]);
    expect(pix).toContain("no Pix");
  });
});
