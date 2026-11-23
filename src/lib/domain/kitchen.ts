import type { Order, OrderItem, PrepStation, Product } from "@/lib/types";

// Regras da tela de preparo (KDS): que pedidos aparecem, com que itens e em que ordem.

export type StationFilter = "kitchen" | "bar" | "all";

/** Pedidos prontos ficam na tela por este tempo, para o garçom ou o entregador ver. */
export const READY_VISIBLE_MS = 5 * 60_000;
/** A ficha fica amarela e depois vermelha conforme o tempo desde a chegada. */
export const WARN_AFTER_MIN = 10;
export const LATE_AFTER_MIN = 20;

export interface KitchenTicket {
  order: Order;
  items: OrderItem[];
  /** Itens de outros setores do mesmo pedido (para a cozinha saber que vem bebida do bar, por exemplo). */
  otherItems: number;
  readyAt: Date | null;
}

export function stationOf(productId: string, products: Pick<Product, "id" | "prepStation">[]): PrepStation {
  return products.find((p) => p.id === productId)?.prepStation ?? "kitchen";
}

function matches(station: PrepStation, filter: StationFilter): boolean {
  if (station === "none") return false;
  return filter === "all" || station === filter;
}

function readyTime(order: Order): Date | null {
  const last = [...order.history].reverse().find((h) => h.status === "pronto");
  return last ? new Date(last.at) : null;
}

export function kitchenTickets(
  orders: Order[],
  products: Pick<Product, "id" | "prepStation">[],
  filter: StationFilter,
  now: Date,
): KitchenTicket[] {
  const tickets: KitchenTicket[] = [];
  for (const order of orders) {
    const readyAt = order.status === "pronto" ? readyTime(order) : null;
    const active = order.status === "novo" || order.status === "em_preparo";
    const recentlyReady = order.status === "pronto" && readyAt !== null && now.getTime() - readyAt.getTime() < READY_VISIBLE_MS;
    if (!active && !recentlyReady) continue;

    const stations = order.items.map((i) => stationOf(i.productId, products));
    const items = order.items.filter((_, i) => matches(stations[i], filter));
    if (!items.length) continue;
    const otherItems = order.items
      .filter((_, i) => stations[i] !== "none" && !matches(stations[i], filter))
      .reduce((n, i) => n + i.quantity, 0);
    tickets.push({ order, items, otherItems, readyAt });
  }
  // Em andamento primeiro, do mais antigo para o mais novo; depois os prontos, o mais recente primeiro.
  return tickets.sort((a, b) => {
    if (!a.readyAt !== !b.readyAt) return a.readyAt ? 1 : -1;
    if (a.readyAt && b.readyAt) return b.readyAt.getTime() - a.readyAt.getTime();
    return new Date(a.order.createdAt).getTime() - new Date(b.order.createdAt).getTime();
  });
}

export type Urgency = "ok" | "warn" | "late";

export function minutesSince(iso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000));
}

export function urgency(order: Pick<Order, "createdAt">, now: Date): Urgency {
  const m = minutesSince(order.createdAt, now);
  if (m >= LATE_AFTER_MIN) return "late";
  if (m >= WARN_AFTER_MIN) return "warn";
  return "ok";
}
