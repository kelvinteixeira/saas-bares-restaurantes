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
const { cancelNfce, emitNfce, newStoreFiscal, saveStoreFiscal } = await import("@/lib/store/fiscal");
const { DEMO_STORE_ID } = await import("@/lib/seed");
const { addToTab } = await import("@/lib/store/tabs");
const { openCash, registerPayment } = await import("@/lib/store/cash");

const order = () =>
  placeOrder({
    storeId: DEMO_STORE_ID,
    mode: "pickup",
    lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 2 }],
    customer: { name: "Ana", phone: "81999990000" },
    payment: { method: "pix" },
  });

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
  mutate((db) => {
    db.stores.find((s) => s.id === DEMO_STORE_ID)!.manualStatus = "open";
  });
});

describe("NFC-e na loja local (simulador)", () => {
  it("só emite com os dados fiscais salvos e a emissão ligada", async () => {
    const o = await order();
    await expect(emitNfce({ orderId: o.id })).rejects.toThrow("desligada");
    await expect(saveStoreFiscal({ ...newStoreFiscal(DEMO_STORE_ID), cnpj: "123" })).rejects.toThrow("CNPJ");
    await saveStoreFiscal({ ...newStoreFiscal(DEMO_STORE_ID), cnpj: "11.222.333/0001-81", ie: "0321418406", legalName: "Bar do Cais LTDA" });
    await expect(emitNfce({ orderId: o.id })).rejects.toThrow("desligada");
  });

  it("emite, não deixa emitir duas vezes, cancela com motivo e emite de novo", async () => {
    await saveStoreFiscal({ ...newStoreFiscal(DEMO_STORE_ID), cnpj: "11222333000181", ie: "0321418406", legalName: "Bar do Cais LTDA", enabled: true });
    const o = await order();
    const doc = await emitNfce({ orderId: o.id }, "529.982.247-25");
    expect(doc).toMatchObject({ status: "authorized", number: 1, series: 1, provider: "simulador", total: o.total, cpf: "52998224725" });
    expect(doc.accessKey).toMatch(/^\d{44}$/);
    await expect(emitNfce({ orderId: o.id })).rejects.toThrow("já tem uma nota");
    await expect(cancelNfce(doc, "erro")).rejects.toThrow("motivo");
    const cancelled = await cancelNfce(doc, "Cliente desistiu do pedido");
    expect(cancelled.status).toBe("cancelled");
    const again = await emitNfce({ orderId: o.id });
    expect(again.number).toBe(2);
    expect((getDb().fiscalDocs ?? []).filter((d) => d.orderId === o.id)).toHaveLength(2);
  });
});

describe("NFC-e da mesa na loja local (simulador)", () => {
  it("só depois da mesa fechada e paga; uma nota por comanda", async () => {
    await saveStoreFiscal({ ...newStoreFiscal(DEMO_STORE_ID), cnpj: "11222333000181", ie: "0321418406", legalName: "Bar do Cais LTDA", enabled: true });
    await openCash(DEMO_STORE_ID, 0);
    const o = await addToTab(DEMO_STORE_ID, 2, [{ key: "i", productId: "p-isca", selections: {}, quantity: 2 }]); // 8400 + 10% = 9240
    const tabId = o.tabId!;
    await expect(emitNfce({ tabId })).rejects.toThrow("Feche a mesa");
    await registerPayment({ tabId, method: "credit", amount: 4000 });
    const last = await registerPayment({ tabId, method: "cash", received: 6000 });
    expect(last.tabClosed).toBe(true);
    const doc = await emitNfce({ tabId });
    expect(doc).toMatchObject({ status: "authorized", tabId, total: 9240 });
    expect(doc.orderId).toBeUndefined();
    await expect(emitNfce({ tabId })).rejects.toThrow("comanda já tem uma nota");
  });
});
