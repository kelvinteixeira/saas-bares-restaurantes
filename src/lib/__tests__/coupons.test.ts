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
const { placeOrder, cancelOrder, CheckoutError } = await import("@/lib/store/actions");
const { saveCoupon, deleteCoupon, checkCoupon, newCoupon, CouponError } = await import("@/lib/store/coupons");
const { couponStatus, evaluateCoupon } = await import("@/lib/domain/coupons");
const { tabTotals } = await import("@/lib/domain/tabs");
const { DEMO_STORE_ID } = await import("@/lib/seed");

type Input = Parameters<typeof placeOrder>[0];
const base = (over: Partial<Input> = {}): Input => ({
  storeId: DEMO_STORE_ID,
  mode: "pickup",
  lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 2 }], // R$ 84,00
  customer: { name: "Ana", phone: "81999990000" },
  payment: { method: "pix" },
  ...over,
});
const coupon = (over: Partial<ReturnType<typeof newCoupon>>) => saveCoupon({ ...newCoupon(DEMO_STORE_ID), ...over });

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
  mutate((db) => {
    db.stores.find((s) => s.id === DEMO_STORE_ID)!.manualStatus = "open";
  });
});

describe("cupons", () => {
  it("cadastra com código normalizado e recusa código inválido ou repetido", async () => {
    const c = await coupon({ code: " dez10 ", kind: "percent", value: 10 });
    expect(c.code).toBe("DEZ10");
    await expect(coupon({ code: "a b" })).rejects.toThrow(CouponError);
    await expect(coupon({ code: "DEZ10" })).rejects.toThrow("Já existe");
    await expect(coupon({ code: "CEM", kind: "percent", value: 150 })).rejects.toThrow("1 a 100");
    await deleteCoupon(c);
    expect(getDb().coupons).toEqual([]);
  });

  it("pedido com 10%: desconto sobre os itens e total já abatido", async () => {
    await coupon({ code: "DEZ", kind: "percent", value: 10 });
    expect(await checkCoupon(DEMO_STORE_ID, "dez", { subtotal: 8400, fee: 0, mode: "pickup", phone: "" })).toEqual({ code: "DEZ", discount: 840 });
    const o = await placeOrder(base({ couponCode: "dez" }));
    expect(o).toMatchObject({ discount: 840, total: 7560, couponCode: "DEZ" });
    await expect(placeOrder(base({ couponCode: "DEZ", payment: { method: "cash", changeFor: 7000 } }))).rejects.toThrow("troco");
  });

  it("valor fixo não deixa o total negativo; entrega grátis só na entrega", async () => {
    await coupon({ code: "CEMREAIS", kind: "fixed", value: 10000 });
    expect((await placeOrder(base({ couponCode: "CEMREAIS" }))).total).toBe(0);
    await coupon({ code: "FRETE", kind: "free_delivery", value: 0 });
    const d = await placeOrder(base({ couponCode: "FRETE", mode: "delivery", delivery: { regionId: "r-centro", street: "Rua A", number: "1" } }));
    expect(d.discount).toBe(d.deliveryFee);
    expect(d.total).toBe(d.subtotal);
    await expect(placeOrder(base({ couponCode: "FRETE" }))).rejects.toThrow("entrega grátis");
  });

  it("limite de usos, cancelado libera; uma vez por WhatsApp", async () => {
    await coupon({ code: "UMUSO", kind: "percent", value: 5, maxUses: 1 });
    const first = await placeOrder(base({ couponCode: "UMUSO" }));
    await expect(placeOrder(base({ couponCode: "UMUSO" }))).rejects.toThrow("esgotou");
    await cancelOrder(first.id);
    expect((await placeOrder(base({ couponCode: "UMUSO" }))).discount).toBeGreaterThan(0);

    await coupon({ code: "PRIMEIRA", kind: "percent", value: 15, oncePerCustomer: true });
    await placeOrder(base({ couponCode: "PRIMEIRA" }));
    await expect(placeOrder(base({ couponCode: "PRIMEIRA" }))).rejects.toThrow("já usou");
    expect((await placeOrder(base({ couponCode: "PRIMEIRA", customer: { name: "Bia", phone: "81988887777" } }))).discount).toBeGreaterThan(0);
  });

  it("mínimo, datas, desativado e inexistente", async () => {
    await coupon({ code: "MINIMO", kind: "percent", value: 5, minOrder: 10000 });
    await expect(placeOrder(base({ couponCode: "MINIMO" }))).rejects.toThrow("a partir de");
    await coupon({ code: "AMANHA", kind: "percent", value: 5, startsAt: new Date(Date.now() + 86400000).toISOString() });
    await expect(placeOrder(base({ couponCode: "AMANHA" }))).rejects.toThrow("ainda não começou");
    await coupon({ code: "DESLIGADO", kind: "percent", value: 5, active: false });
    await expect(placeOrder(base({ couponCode: "DESLIGADO" }))).rejects.toThrow(CheckoutError);
    await expect(placeOrder(base({ couponCode: "NADA" }))).rejects.toThrow("Cupom inválido");
  });

  it("mesa: a conta soma o consumo já com o desconto", async () => {
    await coupon({ code: "MESA20", kind: "percent", value: 20 });
    const o = await placeOrder(base({ couponCode: "MESA20", mode: "table", tableNumber: 9, customer: { name: "Mesa", phone: "" } }));
    const tab = getDb().tabs!.find((t) => t.id === o.tabId)!;
    expect(tabTotals(tab, getDb().orders)).toMatchObject({ consumption: 6720, fee: 672, total: 7392 });
  });

  it("situação do cupom no painel", () => {
    const now = new Date();
    const c = { ...newCoupon("s"), code: "X10", maxUses: 1 };
    expect(couponStatus(c, [], now)).toBe("active");
    expect(couponStatus({ ...c, active: false }, [], now)).toBe("off");
    expect(couponStatus({ ...c, endsAt: new Date(now.getTime() - 1000).toISOString() }, [], now)).toBe("expired");
    expect(() => evaluateCoupon(undefined, { subtotal: 1, fee: 0, mode: "pickup", phone: "", now, orders: [] })).toThrow("Cupom inválido");
  });
});
