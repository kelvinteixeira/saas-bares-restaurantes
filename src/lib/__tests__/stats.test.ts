import { describe, expect, it } from "vitest";
import { buildDemoDb } from "@/lib/seed";
import { hourlyBuckets, modeSplit, niceTicks, ordersOfDay, summarize, topProducts } from "@/lib/domain/stats";

const now = new Date(2026, 10, 23, 14, 30);
const db = buildDemoDb(now);

describe("números do painel", () => {
  it("o resumo de hoje bate com a soma das horas", () => {
    const today = summarize(ordersOfDay(db.orders, now));
    const buckets = hourlyBuckets(db.orders, now, "revenue", 0, 23);
    const sum = buckets.reduce((s, b) => s + (b.value ?? 0), 0);
    expect(sum).toBe(today.revenue);
    const counts = hourlyBuckets(db.orders, now, "orders", 0, 23).reduce((s, b) => s + (b.value ?? 0), 0);
    expect(counts).toBe(today.orders);
  });

  it("horas que ainda não chegaram ficam vazias, não zeradas", () => {
    const buckets = hourlyBuckets(db.orders, now, "orders", 11, 23);
    expect(buckets.find((b) => b.hour === 15)?.value).toBeNull();
    expect(buckets.find((b) => b.hour === 14)?.value).not.toBeNull();
  });

  it("cancelados não contam no faturamento", () => {
    const all = db.orders.filter((o) => new Date(o.createdAt).getDate() === 23);
    const valid = ordersOfDay(db.orders, now);
    expect(valid.length).toBe(all.filter((o) => o.status !== "cancelado").length);
  });

  it("divisão por modalidade soma o total de pedidos", () => {
    const today = ordersOfDay(db.orders, now);
    const split = modeSplit(today);
    expect(split.delivery + split.pickup + split.table).toBe(today.length);
  });

  it("mais vendidos vêm ordenados por quantidade", () => {
    const top = topProducts(ordersOfDay(db.orders, now));
    for (let i = 1; i < top.length; i++) expect(top[i - 1].quantity).toBeGreaterThanOrEqual(top[i].quantity);
  });

  it("ticks do eixo ficam redondos e acima do máximo", () => {
    expect(niceTicks(37)).toEqual([0, 10, 20, 30, 40]);
    const t = niceTicks(184500);
    expect(t[t.length - 1]).toBeGreaterThan(184500);
    expect(niceTicks(0)).toEqual([0, 1]);
  });
});
