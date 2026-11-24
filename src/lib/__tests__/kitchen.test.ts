import { describe, expect, it } from "vitest";
import type { Order, OrderItem, Product } from "@/lib/types";
import { kitchenTickets, urgency } from "@/lib/domain/kitchen";
import { canSee, homeFor, pageOf } from "@/lib/domain/roles";

const now = new Date("2026-11-23T20:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString();

const products: Pick<Product, "id" | "prepStation">[] = [
  { id: "batata" }, // sem setor = cozinha
  { id: "caipi", prepStation: "bar" },
  { id: "cerveja", prepStation: "none" },
];

const item = (productId: string, quantity = 1): OrderItem => ({ productId, name: productId, unitPrice: 100, quantity, options: [] });

function order(id: string, over: Partial<Order>): Order {
  return {
    id,
    storeId: "s",
    number: 1,
    createdAt: ago(5),
    promisedAt: ago(-30),
    status: "novo",
    history: [{ status: "novo", at: ago(5) }],
    mode: "table",
    tableNumber: 1,
    customer: { name: "Mesa 1", phone: "" },
    items: [item("batata")],
    subtotal: 100,
    deliveryFee: 0,
    total: 100,
    payment: { method: "cash" },
    ...over,
  };
}

describe("tela de preparo", () => {
  it("mostra só os itens do setor e conta os de outros setores", () => {
    const o = order("a", { items: [item("batata", 2), item("caipi", 3), item("cerveja", 4)] });
    const [kitchen] = kitchenTickets([o], products, "kitchen", now);
    expect(kitchen.items.map((i) => i.productId)).toEqual(["batata"]);
    expect(kitchen.otherItems).toBe(3); // as caipirinhas; a cerveja não passa por setor nenhum
    const [bar] = kitchenTickets([o], products, "bar", now);
    expect(bar.items.map((i) => i.productId)).toEqual(["caipi"]);
    expect(kitchenTickets([o], products, "all", now)[0].items).toHaveLength(2);
  });

  it("esconde pedido só com itens que não são preparados", () => {
    expect(kitchenTickets([order("a", { items: [item("cerveja")] })], products, "all", now)).toEqual([]);
  });

  it("esconde concluídos, cancelados e prontos há mais de 5 minutos", () => {
    const list = [
      order("feito", { status: "concluido" }),
      order("cancelado", { status: "cancelado" }),
      order("pronto-velho", { status: "pronto", history: [{ status: "pronto", at: ago(6) }] }),
      order("pronto-novo", { status: "pronto", history: [{ status: "pronto", at: ago(2) }] }),
    ];
    expect(kitchenTickets(list, products, "kitchen", now).map((t) => t.order.id)).toEqual(["pronto-novo"]);
  });

  it("ordena: em andamento do mais antigo ao mais novo, prontos no fim", () => {
    const list = [
      order("novo-recente", { createdAt: ago(1) }),
      order("pronto", { status: "pronto", history: [{ status: "pronto", at: ago(1) }] }),
      order("preparo-antigo", { status: "em_preparo", createdAt: ago(15) }),
    ];
    expect(kitchenTickets(list, products, "kitchen", now).map((t) => t.order.id)).toEqual(["preparo-antigo", "novo-recente", "pronto"]);
  });

  it("fica amarela aos 10 minutos e vermelha aos 20", () => {
    expect(urgency({ createdAt: ago(9) }, now)).toBe("ok");
    expect(urgency({ createdAt: ago(10) }, now)).toBe("warn");
    expect(urgency({ createdAt: ago(20) }, now)).toBe("late");
  });
});

describe("telas por função", () => {
  it("cada função vê só as suas telas", () => {
    expect(canSee("owner", "/painel/equipe")).toBe(true);
    expect(canSee("manager", "/painel/equipe")).toBe(false);
    expect(canSee("manager", "/painel/configuracoes")).toBe(true);
    expect(canSee("cashier", "/painel")).toBe(false);
    expect(canSee("cashier", "/painel/pedidos")).toBe(true);
    expect(canSee("waiter", "/painel/cozinha")).toBe(false);
    expect(canSee("kitchen", "/painel/cozinha")).toBe(true);
    expect(canSee("kitchen", "/painel/pedidos")).toBe(false);
    expect(canSee("owner", "/painel/qualquer-coisa")).toBe(false);
    expect(canSee("manager", "/painel/relatorios")).toBe(true);
    expect(canSee("cashier", "/painel/relatorios")).toBe(false);
    expect(canSee("cashier", "/painel/caixa")).toBe(true);
    expect(canSee("waiter", "/painel/caixa")).toBe(false);
  });

  it("reconhece subpáginas e manda cada função para a sua tela inicial", () => {
    expect(pageOf("/painel/pedidos/123")).toBe("/painel/pedidos");
    expect(pageOf("/painel")).toBe("/painel");
    expect(homeFor("owner")).toBe("/painel");
    expect(homeFor("kitchen")).toBe("/painel/cozinha");
    expect(homeFor("waiter")).toBe("/painel/pedidos");
  });
});
