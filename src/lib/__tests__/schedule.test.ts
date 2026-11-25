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
const { placeOrder, CheckoutError } = await import("@/lib/store/actions");
const { checkSchedule, readyForKitchen, scheduleSlots, ScheduleError } = await import("@/lib/domain/schedule");
const { DEMO_STORE_ID } = await import("@/lib/seed");
import type { Store, WeeklyHours } from "@/lib/types";

const day = [{ open: "11:00", close: "23:00" }];
const hours = { 0: day, 1: day, 2: day, 3: day, 4: day, 5: day, 6: day } as WeeklyHours;
const store: Pick<Store, "hours" | "scheduling" | "delivery" | "pickup"> = {
  hours,
  scheduling: { enabled: true, leadMinutes: 60, maxDays: 2 },
  delivery: { enabled: true, minOrder: 0, etaMin: 30, etaMax: 50, regions: [] },
  pickup: { enabled: true, etaMin: 20, etaMax: 30 },
};
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const now = at(25, 21, 10); // 25/11, 21:10

describe("horários de agendamento", () => {
  it("de 30 em 30, a partir da antecedência, só no expediente e até o limite de dias", () => {
    const days = scheduleSlots(store, now);
    expect(days.map((d) => d.label)).toEqual(["Hoje", "Amanhã", days[2].label]);
    expect(days[0].slots.map((s) => s.getHours() * 60 + s.getMinutes())).toEqual([22 * 60 + 30]); // 22:10 → 22:30; fecha 23:00
    expect(days[1].slots[0]).toEqual(at(26, 11));
    expect(days[1].slots.at(-1)).toEqual(at(26, 22, 30));
    expect(days[1].slots).toHaveLength(24);
    expect(days[2].slots.at(-1)!.getTime()).toBeLessThanOrEqual(now.getTime() + 2 * 86_400_000);
  });

  it("desligado não tem horários", () => {
    expect(scheduleSlots({ ...store, scheduling: { enabled: false, leadMinutes: 60, maxDays: 2 } }, now)).toEqual([]);
  });

  it("confere o horário com as mesmas mensagens do banco", () => {
    expect(() => checkSchedule(store, at(26, 12), "pickup", now)).not.toThrow();
    expect(() => checkSchedule(store, at(26, 12, 15), "pickup", now)).toThrow("horários da lista");
    expect(() => checkSchedule(store, at(26, 3), "pickup", now)).toThrow("fechada nesse horário");
    expect(() => checkSchedule(store, at(25, 22), "pickup", now)).toThrow("já não dá mais");
    expect(() => checkSchedule(store, at(29, 12), "pickup", now)).toThrow("até 2 dias");
    expect(() => checkSchedule(store, at(26, 12), "table", now)).toThrow(ScheduleError);
  });

  it("vai para a cozinha só perto da hora (prazo da modalidade antes)", () => {
    const order = { mode: "delivery" as const, scheduledFor: at(26, 12).toISOString() };
    expect(readyForKitchen(order, store, at(26, 11, 9))).toBe(false);
    expect(readyForKitchen(order, store, at(26, 11, 10))).toBe(true); // 50 min antes
    expect(readyForKitchen({ mode: "pickup" }, store, now)).toBe(true);
  });
});

describe("pedido agendado na loja local", () => {
  beforeEach(() => {
    memory.clear();
    resetCacheForTests();
  });

  it("loja fechada agora aceita pedido agendado; o prazo vira o horário escolhido", async () => {
    mutate((db) => {
      const s = db.stores.find((x) => x.id === DEMO_STORE_ID)!;
      s.manualStatus = "closed";
      s.scheduling = { enabled: true, leadMinutes: 60, maxDays: 7 };
    });
    const s = getDb().stores.find((x) => x.id === DEMO_STORE_ID)!;
    const slot = scheduleSlots(s, new Date()).find((d) => d.slots.length)!.slots[0];
    const base = {
      storeId: DEMO_STORE_ID,
      mode: "pickup" as const,
      lines: [{ key: "k", productId: "p-isca", selections: {}, quantity: 1 }],
      customer: { name: "Ana", phone: "81999990000" },
      payment: { method: "pix" as const },
    };
    await expect(placeOrder(base)).rejects.toThrow("fechou");
    const o = await placeOrder({ ...base, scheduledFor: slot.toISOString() });
    expect(o.scheduledFor).toBe(slot.toISOString());
    expect(o.promisedAt).toBe(slot.toISOString());
    await expect(placeOrder({ ...base, scheduledFor: new Date(slot.getTime() + 60_000).toISOString() })).rejects.toThrow(CheckoutError);
  });
});
