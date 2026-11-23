import { beforeEach, describe, expect, it } from "vitest";

// O "banco" da fase 1 usa window.localStorage; aqui um substituto em memória.
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
const { placeOrder, CheckoutError, fillSampleMenu, advanceOrder, cancelOrder } = await import("@/lib/store/actions");
const { signUp, signIn, AuthError } = await import("@/lib/store/auth");
const { DEMO_STORE_ID } = await import("@/lib/seed");

type Input = Parameters<typeof placeOrder>[0];

function openDemo() {
  mutate((db) => {
    db.stores.find((s) => s.id === DEMO_STORE_ID)!.manualStatus = "open";
  });
}

function base(over: Partial<Input> = {}): Input {
  return {
    storeId: DEMO_STORE_ID,
    mode: "pickup",
    lines: [{ key: "k1", productId: "p-isca", selections: {}, quantity: 2 }],
    customer: { name: "Ana", phone: "81999990000" },
    payment: { method: "pix" },
    ...over,
  };
}

beforeEach(() => {
  memory.clear();
  resetCacheForTests();
  openDemo();
});

describe("criar pedido (validações do servidor)", () => {
  it("aceita um pedido válido e calcula os totais a partir do cardápio", async () => {
    const order = await placeOrder(base());
    expect(order.subtotal).toBe(8400);
    expect(order.total).toBe(8400);
    expect(order.status).toBe("novo");
    expect(getDb().orders.at(-1)!.id).toBe(order.id);
  });

  it("cobra a taxa do bairro na entrega", async () => {
    const order = await placeOrder(
      base({ mode: "delivery", delivery: { regionId: "r-centro", street: "Rua A", number: "10" } }),
    );
    expect(order.deliveryFee).toBe(500);
    expect(order.total).toBe(8900);
  });

  it("recusa loja fechada", async () => {
    mutate((db) => {
      db.stores[0].manualStatus = "closed";
    });
    await expect(placeOrder(base())).rejects.toThrow(CheckoutError);
  });

  it("recusa item sem a escolha obrigatória", async () => {
    await expect(placeOrder(base({ lines: [{ key: "k", productId: "p-baiao", selections: {}, quantity: 1 }] }))).rejects.toThrow(CheckoutError);
  });

  it("recusa opção que esgotou", async () => {
    mutate((db) => {
      const g = db.products.find((p) => p.id === "p-batata")!.optionGroups[1];
      g.options.find((o) => o.id === "o-bacon")!.available = false;
    });
    const line = { key: "k", productId: "p-batata", selections: { "g-batata-tam": ["o-meia"], "g-batata-add": ["o-bacon"] }, quantity: 1 };
    await expect(placeOrder(base({ lines: [line] }))).rejects.toThrow(CheckoutError);
  });

  it("recusa opção repetida para cobrar duas vezes", async () => {
    const line = { key: "k", productId: "p-batata", selections: { "g-batata-tam": ["o-inteira", "o-inteira"] }, quantity: 1 };
    await expect(placeOrder(base({ lines: [line] }))).rejects.toThrow(CheckoutError);
  });

  it("recusa item de categoria escondida", async () => {
    mutate((db) => {
      db.categories.find((c) => c.id === "c-petiscos")!.visible = false;
    });
    await expect(placeOrder(base())).rejects.toThrow(CheckoutError);
  });

  it("recusa quantidade zero, negativa ou quebrada", async () => {
    for (const quantity of [0, -1, 1.5, 1000]) {
      await expect(placeOrder(base({ lines: [{ key: "k", productId: "p-isca", selections: {}, quantity }] }))).rejects.toThrow(CheckoutError);
    }
  });

  it("recusa forma de pagamento desligada pela loja", async () => {
    mutate((db) => {
      db.stores[0].payment.cash = false;
    });
    await expect(placeOrder(base({ payment: { method: "cash" } }))).rejects.toThrow(CheckoutError);
  });

  it("recusa troco menor que o total", async () => {
    await expect(placeOrder(base({ payment: { method: "cash", changeFor: 5000 } }))).rejects.toThrow(CheckoutError);
  });

  it("recusa cliente sem nome, e entrega/retirada sem WhatsApp válido", async () => {
    await expect(placeOrder(base({ customer: { name: "  ", phone: "81999990000" } }))).rejects.toThrow(CheckoutError);
    await expect(placeOrder(base({ customer: { name: "Ana", phone: "123" } }))).rejects.toThrow(CheckoutError);
  });

  it("recusa entrega sem rua ou número", async () => {
    await expect(
      placeOrder(base({ mode: "delivery", delivery: { regionId: "r-centro", street: " ", number: "10" } })),
    ).rejects.toThrow(CheckoutError);
  });

  it("recusa bairro desativado", async () => {
    await expect(
      placeOrder(base({ mode: "delivery", delivery: { regionId: "r-ilha", street: "Rua A", number: "1" } })),
    ).rejects.toThrow(CheckoutError);
  });

  it("pedido na mesa não exige WhatsApp, mas exige mesa válida", async () => {
    const ok = await placeOrder(base({ mode: "table", tableNumber: 3, customer: { name: "Mesa", phone: "" } }));
    expect(ok.tableNumber).toBe(3);
    await expect(placeOrder(base({ mode: "table", tableNumber: 99, customer: { name: "Mesa", phone: "" } }))).rejects.toThrow(CheckoutError);
  });

  it("numera os pedidos em sequência", async () => {
    const a = await placeOrder(base());
    const b = await placeOrder(base());
    expect(b.number).toBe(a.number + 1);
  });
});

describe("andamento do pedido", () => {
  it("avança pelo fluxo e não cancela depois de sair para entrega", async () => {
    const order = await placeOrder(base({ mode: "delivery", delivery: { regionId: "r-centro", street: "Rua A", number: "1" } }));
    await advanceOrder(order.id); // em preparo
    await advanceOrder(order.id); // pronto
    await advanceOrder(order.id); // a caminho
    await cancelOrder(order.id);
    const saved = getDb().orders.find((o) => o.id === order.id)!;
    expect(saved.status).toBe("a_caminho");
    expect(saved.history.map((h) => h.status)).toEqual(["novo", "em_preparo", "pronto", "a_caminho"]);
  });
});

describe("cardápio de exemplo", () => {
  it("adiciona uma vez e não duplica num segundo clique", async () => {
    await signUp({ name: "Dono", email: "dono@exemplo.local", password: "senha-segura-1", storeName: "Bar Novo" });
    const storeId = getDb().stores.find((s) => s.name === "Bar Novo")!.id;
    expect(await fillSampleMenu(storeId)).toBe(true);
    expect(await fillSampleMenu(storeId)).toBe(false);
    expect(getDb().products.filter((p) => p.storeId === storeId)).toHaveLength(17);
    expect(getDb().categories.filter((c) => c.storeId === storeId)).toHaveLength(5);
  });
});

describe("conta", () => {
  it("cria, sai e entra de novo com a senha certa", async () => {
    await signUp({ name: "Dono", email: "Dono@Exemplo.local", password: "senha-segura-1", storeName: "Bar Novo" });
    mutate((db) => {
      db.session = null;
    });
    await expect(signIn("dono@exemplo.local", "errada-123")).rejects.toThrow(AuthError);
    await signIn("dono@exemplo.local", "senha-segura-1");
    expect(getDb().session).not.toBeNull();
  });

  it("recusa e-mail repetido, e-mail inválido, senha curta e nomes vazios", async () => {
    await signUp({ name: "Dono", email: "dono@exemplo.local", password: "senha-segura-1", storeName: "Bar Novo" });
    await expect(signUp({ name: "B", email: "dono@exemplo.local", password: "senha-segura-1", storeName: "X" })).rejects.toThrow(AuthError);
    await expect(signUp({ name: "B", email: "sem-arroba", password: "senha-segura-1", storeName: "X" })).rejects.toThrow(AuthError);
    await expect(signUp({ name: "B", email: "b@exemplo.local", password: "1234567", storeName: "X" })).rejects.toThrow(AuthError);
    await expect(signUp({ name: " ", email: "c@exemplo.local", password: "senha-segura-1", storeName: " " })).rejects.toThrow(AuthError);
  });

  it("a conta de demonstração não entra por senha", async () => {
    await expect(signIn("demo@comanda.local", "")).rejects.toThrow(AuthError);
  });
});
