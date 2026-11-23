import { describe, expect, it } from "vitest";
import { advanceLabel, canCancel, isLate, nextStatus, statusFlow } from "@/lib/domain/orders";
import { buildDemoDb } from "@/lib/seed";

describe("fluxo do pedido", () => {
  it("entrega passa por 'a caminho'; retirada e mesa não", () => {
    expect(nextStatus({ mode: "delivery", status: "pronto" })).toBe("a_caminho");
    expect(nextStatus({ mode: "pickup", status: "pronto" })).toBe("concluido");
    expect(nextStatus({ mode: "table", status: "pronto" })).toBe("concluido");
    expect(nextStatus({ mode: "delivery", status: "concluido" })).toBeNull();
    expect(nextStatus({ mode: "pickup", status: "cancelado" })).toBeNull();
  });

  it("nomeia a próxima ação na língua do balcão", () => {
    expect(advanceLabel({ mode: "delivery", status: "novo" })).toBe("Aceitar");
    expect(advanceLabel({ mode: "delivery", status: "a_caminho" })).toBe("Entregue");
    expect(advanceLabel({ mode: "pickup", status: "pronto" })).toBe("Retirado");
    expect(advanceLabel({ mode: "table", status: "pronto" })).toBe("Servido");
  });

  it("só cancela antes de sair para entrega", () => {
    expect(canCancel({ status: "em_preparo" })).toBe(true);
    expect(canCancel({ status: "a_caminho" })).toBe(false);
  });

  it("marca atraso só em pedidos abertos", () => {
    const now = new Date(2026, 10, 23, 14, 0);
    const promisedAt = new Date(2026, 10, 23, 13, 50).toISOString();
    expect(isLate({ status: "em_preparo", promisedAt }, now)).toBe(true);
    expect(isLate({ status: "concluido", promisedAt }, now)).toBe(false);
  });
});

describe("dados de demonstração", () => {
  const now = new Date(2026, 10, 23, 14, 30); // segunda, no meio do almoço
  const db = buildDemoDb(now);

  it("cada total é a soma dos itens mais a taxa", () => {
    for (const o of db.orders) {
      const subtotal = o.items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
      expect(o.subtotal).toBe(subtotal);
      expect(o.total).toBe(o.subtotal + o.deliveryFee);
      if (o.mode !== "delivery") expect(o.deliveryFee).toBe(0);
    }
  });

  it("status e histórico respeitam o fluxo da modalidade", () => {
    for (const o of db.orders) {
      if (o.status === "cancelado") continue;
      const flow = statusFlow(o.mode);
      expect(flow).toContain(o.status);
      expect(o.history.map((h) => h.status)).toEqual(flow.slice(0, flow.indexOf(o.status) + 1));
    }
  });

  it("não cria pedido no futuro e numera em sequência", () => {
    db.orders.forEach((o, i) => {
      expect(new Date(o.createdAt).getTime()).toBeLessThanOrEqual(now.getTime());
      expect(o.number).toBe(i + 1);
    });
    expect(db.stores[0].nextOrderNumber).toBe(db.orders.length + 1);
  });

  it("tem pedidos abertos agora para a fila", () => {
    expect(db.orders.some((o) => o.status !== "concluido" && o.status !== "cancelado")).toBe(true);
  });
});
