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
const { placeOrder, advanceOrder, cancelOrder, CheckoutError } = await import("@/lib/store/actions");
const { getCashbackInfo, saveCashbackSettings } = await import("@/lib/store/cashback");
const { addToTab } = await import("@/lib/store/tabs");
const { openCash, registerPayment } = await import("@/lib/store/cash");
const { balanceOf, cashbackCustomers } = await import("@/lib/domain/cashback");
const { DEMO_STORE_ID } = await import("@/lib/seed");
import type { CashbackEntry } from "@/lib/types";

type Input = Parameters<typeof placeOrder>[0];
const ANA = "81999990000";
const base = (over: Partial<Input> = {}): Input => ({
  storeId: DEMO_STORE_ID,
  mode: "pickup",
  lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 2 }], // R$ 84,00
  customer: { name: "Ana", phone: ANA },
  payment: { method: "pix" },
  ...over,
});
async function conclude(id: string) {
  for (let i = 0; i < 4; i++) {
    const o = getDb().orders.find((x) => x.id === id)!;
    if (o.status === "concluido") return;
    await advanceOrder(id);
  }
}

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
  mutate((db) => {
    db.stores.find((s) => s.id === DEMO_STORE_ID)!.manualStatus = "open";
  });
});

describe("cashback", () => {
  it("desligado não gera; ligado gera ao concluir, sobre os itens", async () => {
    const off = await placeOrder(base());
    await conclude(off.id);
    expect((await getCashbackInfo(DEMO_STORE_ID, ANA)).balance).toBe(0);

    await saveCashbackSettings(DEMO_STORE_ID, { enabled: true, rate: 10, validDays: 30 });
    const o = await placeOrder(base({ mode: "delivery", delivery: { regionId: "r-centro", street: "Rua A", number: "1" } }));
    expect((await getCashbackInfo(DEMO_STORE_ID, ANA)).balance).toBe(0);
    await conclude(o.id);
    expect(await getCashbackInfo(DEMO_STORE_ID, ANA)).toEqual({ enabled: true, rate: 10, balance: 840 });
  });

  it("usa no pedido, abate do total e devolve se cancelar", async () => {
    await saveCashbackSettings(DEMO_STORE_ID, { enabled: true, rate: 10, validDays: 30 });
    await conclude((await placeOrder(base())).id); // ganha 8,40
    const used = await placeOrder(base({ useCashback: true }));
    expect(used.cashbackUsed).toBe(840);
    expect(used.total).toBe(8400 - 840);
    expect((await getCashbackInfo(DEMO_STORE_ID, ANA)).balance).toBe(0);
    await cancelOrder(used.id);
    expect((await getCashbackInfo(DEMO_STORE_ID, ANA)).balance).toBe(840);
  });

  it("o ganho de um pedido que usou cashback é sobre o que foi pago", async () => {
    await saveCashbackSettings(DEMO_STORE_ID, { enabled: true, rate: 10, validDays: 30 });
    await conclude((await placeOrder(base())).id); // 8,40
    const second = await placeOrder(base({ useCashback: true }));
    await conclude(second.id); // (84 − 8,40) × 10% = 7,56
    expect((await getCashbackInfo(DEMO_STORE_ID, ANA)).balance).toBe(756);
  });

  it("não deixa usar com cashback desligado ou sem WhatsApp; recusa porcentagem fora do limite", async () => {
    await expect(placeOrder(base({ useCashback: true }))).rejects.toThrow(CheckoutError);
    await saveCashbackSettings(DEMO_STORE_ID, { enabled: true, rate: 5, validDays: 60 });
    await expect(placeOrder(base({ useCashback: true, mode: "table", tableNumber: 3, customer: { name: "Mesa", phone: "" } }))).rejects.toThrow("WhatsApp");
    await expect(saveCashbackSettings(DEMO_STORE_ID, { enabled: true, rate: 50, validDays: 60 })).rejects.toThrow("1% a 30%");
  });

  it("mesa fechada pelo caixa também gera cashback para quem deixou o WhatsApp", async () => {
    await saveCashbackSettings(DEMO_STORE_ID, { enabled: true, rate: 10, validDays: 30 });
    const o = await placeOrder(base({ mode: "table", tableNumber: 11, customer: { name: "Ana", phone: ANA } }));
    await addToTab(DEMO_STORE_ID, 11, [{ key: "x", productId: "p-isca", selections: {}, quantity: 1 }]);
    await openCash(DEMO_STORE_ID, 0);
    const tab = getDb().tabs!.find((t) => t.id === o.tabId)!;
    await registerPayment({ tabId: tab.id, method: "pix", amount: Math.round((8400 + 4200) * 1.1) });
    expect((await getCashbackInfo(DEMO_STORE_ID, ANA)).balance).toBe(840); // só o pedido com o WhatsApp
  });

  it("saldo: o que vence primeiro é usado primeiro e vencido sai", () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const day = 86_400_000;
    const at = (d: number) => new Date(now.getTime() + d * day).toISOString();
    const e = (kind: "earn" | "spend", amount: number, created: number, expires?: number): CashbackEntry => ({
      id: Math.random().toString(),
      storeId: "s",
      phone: ANA,
      kind,
      amount,
      createdAt: at(created),
      expiresAt: expires === undefined ? undefined : at(expires),
    });
    const list = [e("earn", 1000, -40, -10), e("earn", 2000, -20, 10), e("earn", 3000, -5, 25), e("spend", 2500, -1)];
    expect(balanceOf(list, "s", ANA, now)).toBe(2500);
    expect(balanceOf(list, "s", ANA, new Date(now.getTime() + 15 * day))).toBe(2500); // o de 2.000 já tinha sido usado
    expect(balanceOf(list, "s", ANA, new Date(now.getTime() + 30 * day))).toBe(0);
    expect(cashbackCustomers(list, [], "s", now)[0]).toMatchObject({ phone: ANA, balance: 2500, earned: 6000, spent: 2500 });
    // Ganho criado segundos depois do relógio da tela já entra no saldo.
    const fresh = [...list, e("earn", 370, 0.0001, 60)];
    expect(balanceOf(fresh, "s", ANA, now)).toBe(2870);
  });
});
