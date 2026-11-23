import { describe, expect, it } from "vitest";
import type { Order, Store, Tab } from "@/lib/types";
import { attachToTab, rateForNewTab, tableMap, tabTotals } from "@/lib/domain/tabs";

const now = new Date("2026-11-23T21:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();
let seq = 0;
const id = () => `id-${++seq}`;

const store: Pick<Store, "id" | "table" | "serviceFee"> = { id: "s", table: { enabled: true, count: 4 }, serviceFee: { enabled: true, rate: 10 } };

function order(over: Partial<Order>): Order {
  return {
    id: id(),
    storeId: "s",
    number: 1,
    createdAt: ago(10),
    promisedAt: ago(-20),
    status: "novo",
    history: [],
    mode: "table",
    tableNumber: 2,
    customer: { name: "Mesa 2", phone: "" },
    items: [],
    subtotal: 1000,
    deliveryFee: 0,
    total: 1000,
    payment: { method: "tab" },
    ...over,
  };
}

describe("comanda", () => {
  it("pedido de mesa abre a comanda; o próximo da mesma mesa entra nela", () => {
    const tabs: Tab[] = [];
    const a = order({ tableNumber: 2 });
    const b = order({ tableNumber: 2 });
    const c = order({ tableNumber: 3 });
    attachToTab(tabs, a, store, id);
    attachToTab(tabs, b, store, id);
    attachToTab(tabs, c, store, id);
    expect(tabs).toHaveLength(2);
    expect(a.tabId).toBe(b.tabId);
    expect(c.tabId).not.toBe(a.tabId);
    expect(tabs[0].serviceFeeRate).toBe(10);
  });

  it("entrega e retirada não entram em comanda", () => {
    const tabs: Tab[] = [];
    expect(attachToTab(tabs, order({ mode: "delivery", tableNumber: undefined }), store, id)).toBeNull();
    expect(tabs).toEqual([]);
  });

  it("pedir mais depois de pedir a conta reabre a comanda; comanda fechada não recebe", () => {
    const tabs: Tab[] = [];
    const first = order({});
    const tab = attachToTab(tabs, first, store, id)!;
    tab.status = "bill_requested";
    attachToTab(tabs, order({}), store, id);
    expect(tab.status).toBe("open");
    tab.status = "closed";
    const next = order({});
    attachToTab(tabs, next, store, id);
    expect(next.tabId).not.toBe(tab.id);
    expect(tabs).toHaveLength(2);
  });

  it("soma o consumo sem os cancelados e calcula a taxa de serviço", () => {
    const tabs: Tab[] = [];
    const list = [order({ subtotal: 4250 }), order({ subtotal: 1999 }), order({ subtotal: 5000, status: "cancelado" })];
    list.forEach((o) => attachToTab(tabs, o, store, id));
    expect(tabTotals(tabs[0], list)).toEqual({ consumption: 6249, rate: 10, fee: 625, total: 6874 });
    expect(tabTotals(tabs[0], list, true)).toEqual({ consumption: 6249, rate: 0, fee: 0, total: 6249 });
  });

  it("taxa desligada ou fora dos limites", () => {
    expect(rateForNewTab({ serviceFee: { enabled: false, rate: 10 } })).toBe(0);
    expect(rateForNewTab({ serviceFee: { enabled: true, rate: 45 } })).toBe(30);
    expect(rateForNewTab({})).toBe(10);
  });

  it("mapa do salão: livre, ocupada, pediu a conta, e o que está na cozinha", () => {
    const tabs: Tab[] = [];
    const list = [
      order({ tableNumber: 1, status: "em_preparo" }),
      order({ tableNumber: 1, status: "pronto" }),
      order({ tableNumber: 3, status: "concluido" }),
    ];
    list.forEach((o) => attachToTab(tabs, o, store, id));
    tabs[0].openedAt = ago(35);
    tabs[1].status = "bill_requested";
    const map = tableMap(store, tabs, list, now);
    expect(map.map((t) => t.status)).toEqual(["open", "free", "bill_requested", "free"]);
    expect(map[0]).toMatchObject({ minutes: 35, cooking: 1, ready: 1 });
    expect(map[0].totals?.total).toBe(2200);
  });
});
