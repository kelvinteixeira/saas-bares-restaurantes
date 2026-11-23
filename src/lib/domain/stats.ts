import type { Order, OrderMode, Store } from "@/lib/types";

export type Metric = "revenue" | "orders" | "ticket";

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Pedidos válidos (não cancelados) feitos no mesmo dia de `day`, até o horário de `until` naquele dia. */
export function ordersOfDay(orders: Order[], day: Date, until?: Date): Order[] {
  return orders.filter((o) => {
    if (o.status === "cancelado") return false;
    const at = new Date(o.createdAt);
    if (!sameDay(at, day)) return false;
    if (!until) return true;
    const limit = new Date(day);
    limit.setHours(until.getHours(), until.getMinutes(), until.getSeconds(), 999);
    return at <= limit;
  });
}

export function summarize(orders: Order[]) {
  const revenue = orders.reduce((s, o) => s + o.total, 0);
  const count = orders.length;
  return { revenue, orders: count, ticket: count ? Math.round(revenue / count) : 0 };
}

export function metricValue(summary: ReturnType<typeof summarize>, metric: Metric): number {
  return metric === "revenue" ? summary.revenue : metric === "orders" ? summary.orders : summary.ticket;
}

export interface HourBucket {
  hour: number;
  value: number | null; // null = hora ainda não chegou
  compare: number;
}

/** Valor por hora de hoje e do mesmo dia da semana passada, entre fromHour e toHour (inclusive). */
export function hourlyBuckets(orders: Order[], now: Date, metric: Exclude<Metric, "ticket">, fromHour: number, toHour: number): HourBucket[] {
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  const today = ordersOfDay(orders, now);
  const before = ordersOfDay(orders, lastWeek);
  const sumAt = (list: Order[], hour: number) => {
    const inHour = list.filter((o) => new Date(o.createdAt).getHours() === hour);
    return metric === "revenue" ? inHour.reduce((s, o) => s + o.total, 0) : inHour.length;
  };
  const buckets: HourBucket[] = [];
  for (let h = fromHour; h <= toHour; h++) {
    buckets.push({ hour: h, value: h > now.getHours() ? null : sumAt(today, h), compare: sumAt(before, h) });
  }
  return buckets;
}

/** Faixa de horas do expediente de hoje (para o eixo do gráfico). */
export function businessHourRange(store: Store, now: Date): [number, number] {
  const intervals = store.hours[now.getDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6] ?? [];
  if (!intervals.length) return [11, 23];
  const opens = intervals.map((iv) => Number(iv.open.slice(0, 2)));
  const closes = intervals.map((iv) => {
    const h = Number(iv.close.slice(0, 2));
    return iv.close <= iv.open ? 23 : Math.max(h - (iv.close.endsWith(":00") ? 1 : 0), 0);
  });
  return [Math.min(...opens), Math.max(...closes)];
}

export interface TopProduct {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
}

export function topProducts(orders: Order[], limit = 5): TopProduct[] {
  const map = new Map<string, TopProduct>();
  for (const o of orders) {
    for (const it of o.items) {
      const row = map.get(it.productId) ?? { productId: it.productId, name: it.name, quantity: 0, revenue: 0 };
      row.quantity += it.quantity;
      row.revenue += it.unitPrice * it.quantity;
      map.set(it.productId, row);
    }
  }
  return [...map.values()].sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue).slice(0, limit);
}

export function modeSplit(orders: Order[]): Record<OrderMode, number> {
  const split: Record<OrderMode, number> = { delivery: 0, pickup: 0, table: 0 };
  for (const o of orders) split[o.mode]++;
  return split;
}

/** Ticks redondos para o eixo Y: o topo fica acima do máximo. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? rough;
  const top = Math.ceil((max + step * 0.0001) / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks[ticks.length - 1] <= max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}
