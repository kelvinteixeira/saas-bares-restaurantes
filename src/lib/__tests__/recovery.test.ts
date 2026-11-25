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
const { cartsOf, dismissCart, markContacted, saveAbandonedCart } = await import("@/lib/store/recovery");
const { cartItemsLabel, cartsToRecover, recoveryLink, recoveryMessage, recoveryStats } = await import("@/lib/domain/recovery");
const { DEMO_STORE_ID } = await import("@/lib/seed");

const products = () => getDb().products.filter((p) => p.storeId === DEMO_STORE_ID);
const snap = (over: Partial<Parameters<typeof saveAbandonedCart>[0]> = {}) => ({
  storeId: DEMO_STORE_ID,
  phone: "(81) 98888-7777",
  name: "Ana Paula",
  mode: "delivery" as const,
  lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 2 }],
  products: products(),
  ...over,
});
const later = (min: number) => new Date(Date.now() + min * 60000);

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
  mutate((db) => {
    db.stores.find((s) => s.id === DEMO_STORE_ID)!.manualStatus = "open";
  });
});

describe("recuperador de vendas", () => {
  it("guarda uma sacola por WhatsApp e só depois de 10 min parada ela aparece para chamar", async () => {
    await saveAbandonedCart(snap());
    await saveAbandonedCart(snap({ lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 3 }] }));
    const [cart] = cartsOf(DEMO_STORE_ID);
    expect(cartsOf(DEMO_STORE_ID)).toHaveLength(1);
    expect(cart).toMatchObject({ phone: "81988887777", status: "open", subtotal: 3 * 4200 });
    expect(cartsToRecover(cartsOf(DEMO_STORE_ID), DEMO_STORE_ID, later(5))).toHaveLength(0);
    expect(cartsToRecover(cartsOf(DEMO_STORE_ID), DEMO_STORE_ID, later(11))).toHaveLength(1);
    expect(cartsToRecover(cartsOf(DEMO_STORE_ID), DEMO_STORE_ID, later(8 * 24 * 60))).toHaveLength(0);
  });

  it("não guarda mesa, telefone incompleto nem sacola vazia", async () => {
    await saveAbandonedCart(snap({ mode: "table" }));
    await saveAbandonedCart(snap({ phone: "8199" }));
    await saveAbandonedCart(snap({ lines: [] }));
    expect(cartsOf(DEMO_STORE_ID)).toHaveLength(0);
  });

  it("chamou no WhatsApp e a pessoa pediu: conta como venda recuperada", async () => {
    await saveAbandonedCart(snap());
    await markContacted(cartsOf(DEMO_STORE_ID)[0]);
    expect(cartsOf(DEMO_STORE_ID)[0].status).toBe("contacted");
    const order = await placeOrder({
      storeId: DEMO_STORE_ID,
      mode: "pickup",
      lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 2 }],
      customer: { name: "Ana", phone: "81988887777" },
      payment: { method: "pix" },
    });
    const [cart] = cartsOf(DEMO_STORE_ID);
    expect(cart).toMatchObject({ status: "converted", orderId: order.id });
    const stats = recoveryStats(cartsOf(DEMO_STORE_ID), getDb().orders, DEMO_STORE_ID, new Date(0), later(1));
    expect(stats).toEqual({ abandoned: 1, contacted: 1, recovered: 1, revenue: order.total });
    const { cancelOrder } = await import("@/lib/store/actions");
    await cancelOrder(order.id);
    expect(recoveryStats(cartsOf(DEMO_STORE_ID), getDb().orders, DEMO_STORE_ID, new Date(0), later(1))).toMatchObject({ recovered: 0, revenue: 0 });
  });

  it("pediu sem ser chamada não conta como abandonada; descartada sai da lista", async () => {
    await saveAbandonedCart(snap());
    await placeOrder({
      storeId: DEMO_STORE_ID,
      mode: "pickup",
      lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 1 }],
      customer: { name: "Ana", phone: "81988887777" },
      payment: { method: "pix" },
    });
    expect(recoveryStats(cartsOf(DEMO_STORE_ID), getDb().orders, DEMO_STORE_ID, new Date(0), later(1))).toMatchObject({ abandoned: 0, recovered: 0 });
    await saveAbandonedCart(snap({ phone: "81977776666" }));
    const open = cartsOf(DEMO_STORE_ID).find((c) => c.phone === "81977776666")!;
    await dismissCart(open);
    expect(cartsToRecover(cartsOf(DEMO_STORE_ID), DEMO_STORE_ID, later(11))).toHaveLength(0);
  });

  it("mensagem com o primeiro nome, os itens, o link e o cupom", () => {
    const cart = {
      id: "c",
      storeId: "s",
      phone: "81988887777",
      name: "Ana Paula",
      items: [
        { productId: "a", name: "Isca", quantity: 2, price: 4200 },
        { productId: "b", name: "Batata", quantity: 1, price: 2400 },
        { productId: "c", name: "Chopp", quantity: 3, price: 1200 },
        { productId: "d", name: "Pudim", quantity: 1, price: 1500 },
      ],
      subtotal: 15900,
      status: "open" as const,
      createdAt: "",
      updatedAt: "",
    };
    expect(cartItemsLabel(cart)).toBe("2× Isca, 1× Batata, 3× Chopp e mais 1 item");
    const msg = recoveryMessage(cart, { name: "Bar do Cais" }, "https://x.test/bar", { code: "VOLTA10", kind: "percent", value: 10 });
    expect(msg).toContain("Oi, Ana!");
    expect(msg).toContain("Bar do Cais");
    expect(msg).toContain("159,00");
    expect(msg).toContain("*VOLTA10* você ganha 10% de desconto");
    expect(msg).toContain("https://x.test/bar");
    expect(recoveryLink(cart, msg).startsWith("https://wa.me/5581988887777?text=")).toBe(true);
    expect(recoveryMessage(cart, { name: "Bar" }, "u")).not.toContain("cupom");
  });
});
