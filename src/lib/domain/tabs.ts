import type { Order, Store, Tab } from "@/lib/types";
import { isOpenOrder } from "@/lib/domain/orders";

// Regras da comanda de mesa. O banco (SQL 003) aplica as mesmas: um pedido de mesa entra na
// comanda aberta daquela mesa, ou abre uma; pedir mais depois de pedir a conta reabre a comanda.

export const DEFAULT_SERVICE_FEE = { enabled: true, rate: 10 } as const;

export function serviceFeeOf(store: Pick<Store, "serviceFee">): { enabled: boolean; rate: number } {
  return store.serviceFee ?? DEFAULT_SERVICE_FEE;
}

/** Percentual que uma comanda nova recebe (0 se a loja não cobra). */
export function rateForNewTab(store: Pick<Store, "serviceFee">): number {
  const fee = serviceFeeOf(store);
  return fee.enabled ? Math.min(Math.max(Math.round(fee.rate), 0), 30) : 0;
}

export function openTabFor(tabs: Tab[], storeId: string, table: number): Tab | undefined {
  return tabs.find((t) => t.storeId === storeId && t.tableNumber === table && t.status !== "closed");
}

export function tabOrders(tab: Pick<Tab, "id">, orders: Order[]): Order[] {
  return orders.filter((o) => o.tabId === tab.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export interface TabTotals {
  /** Soma dos pedidos não cancelados. */
  consumption: number;
  rate: number;
  fee: number;
  total: number;
}

export function tabTotals(tab: Pick<Tab, "id" | "serviceFeeRate" | "serviceFeeRemoved">, orders: Order[], removeFee = tab.serviceFeeRemoved): TabTotals {
  const consumption = tabOrders(tab, orders)
    .filter((o) => o.status !== "cancelado")
    .reduce((sum, o) => sum + o.subtotal - (o.discount ?? 0), 0);
  const rate = removeFee ? 0 : tab.serviceFeeRate;
  const fee = Math.round((consumption * rate) / 100);
  return { consumption, rate, fee, total: consumption + fee };
}

/**
 * Põe o pedido de mesa na comanda certa, criando a comanda se a mesa estiver livre.
 * Muda `tabs` e `order` no lugar (é usado dentro de mutate na loja local).
 */
export function attachToTab(tabs: Tab[], order: Order, store: Pick<Store, "id" | "serviceFee">, newId: () => string, openedBy?: string): Tab | null {
  if (order.mode !== "table" || !order.tableNumber) return null;
  let tab = order.tabId ? tabs.find((t) => t.id === order.tabId) : openTabFor(tabs, store.id, order.tableNumber);
  if (!tab) {
    tab = {
      id: newId(),
      storeId: store.id,
      tableNumber: order.tableNumber,
      status: "open",
      openedBy,
      openedAt: order.createdAt,
      serviceFeeRate: rateForNewTab(store),
      serviceFeeRemoved: false,
    };
    tabs.push(tab);
  }
  if (tab.status === "bill_requested") tab.status = "open";
  order.tabId = tab.id;
  return tab;
}

export type TableStatus = "free" | "open" | "bill_requested";

export interface TableState {
  number: number;
  status: TableStatus;
  tab?: Tab;
  /** Minutos desde que a mesa abriu. */
  minutes: number;
  totals?: TabTotals;
  /** Pedidos ainda na cozinha (novo ou em preparo). */
  cooking: number;
  /** Pedidos prontos esperando ir para a mesa. */
  ready: number;
}

/** Mapa do salão: uma entrada por mesa da loja (1..N), mais mesas com comanda aberta acima de N. */
export function tableMap(store: Pick<Store, "id" | "table">, tabs: Tab[], orders: Order[], now: Date): TableState[] {
  const open = tabs.filter((t) => t.storeId === store.id && t.status !== "closed");
  const count = Math.max(store.table.count, ...open.map((t) => t.tableNumber), 0);
  return Array.from({ length: count }, (_, i) => {
    const number = i + 1;
    const tab = open.find((t) => t.tableNumber === number);
    if (!tab) return { number, status: "free" as const, minutes: 0, cooking: 0, ready: 0 };
    const list = tabOrders(tab, orders);
    return {
      number,
      status: tab.status === "bill_requested" ? ("bill_requested" as const) : ("open" as const),
      tab,
      minutes: Math.max(0, Math.floor((now.getTime() - new Date(tab.openedAt).getTime()) / 60_000)),
      totals: tabTotals(tab, orders),
      cooking: list.filter((o) => o.status === "novo" || o.status === "em_preparo").length,
      ready: list.filter((o) => o.status === "pronto").length,
    };
  });
}

/** Pedidos da comanda que ainda não foram servidos (para avisar antes de fechar). */
export function unservedOrders(tab: Pick<Tab, "id">, orders: Order[]): Order[] {
  return tabOrders(tab, orders).filter((o) => isOpenOrder(o) && o.status !== "pronto");
}
