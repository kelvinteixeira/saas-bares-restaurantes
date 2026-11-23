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
  it("aceita um pedido válido e calcula os totais a partir do cardápio", () => {
    const order = placeOrder(base());
    expect(order.subtotal).toBe(8400);
    expect(order.total).toBe(8400);
    expect(order.status).toBe("novo");
    expect(getDb().orders.at(-1)!.id).toBe(order.id);
  });

  it("cobra a taxa do bairro na entrega", () => {
    const order = placeOrder(
      base({ mode: "delivery", delivery: { regionId: "r-centro", street: "Rua A", number: "10" } }),
    );
    expect(order.deliveryFee).toBe(500);
    expect(order.total).toBe(8900);
  });

  it("recusa loja fechada", () => {
    mutate((db) => {
      db.stores[0].manualStatus = "closed";
    });
    expect(() => placeOrder(base())).toThrow(CheckoutError);
  });

  it("recusa item sem a escolha obrigatória", () => {
    expect(() => placeOrder(base({ lines: [{ key: "k", productId: "p-baiao", selections: {}, quantity: 1 }] }))).toThrow(
      CheckoutError,
    );
  });

  it("recusa opção que esgotou", () => {
    mutate((db) => {
      const g = db.products.find((p) => p.id === "p-batata")!.optionGroups[1];
      g.options.find((o) => o.id === "o-bacon")!.available = false;
    });
    const line = { key: "k", productId: "p-batata", selections: { "g-batata-tam": ["o-meia"], "g-batata-add": ["o-bacon"] }, quantity: 1 };
    expect(() => placeOrder(base({ lines: [line] }))).toThrow(CheckoutError);
  });

  it("recusa opção repetida para cobrar duas vezes", () => {
    const line = { key: "k", productId: "p-batata", selections: { "g-batata-tam": ["o-inteira", "o-inteira"] }, quantity: 1 };
    expect(() => placeOrder(base({ lines: [line] }))).toThrow(CheckoutError);
  });

  it("recusa item de categoria escondida", () => {
    mutate((db) => {
      db.categories.find((c) => c.id === "c-petiscos")!.visible = false;
    });
    expect(() => placeOrder(base())).toThrow(CheckoutError);
  });

  it("recusa quantidade zero, negativa ou quebrada", () => {
    for (const quantity of [0, -1, 1.5, 1000]) {
      expect(() => placeOrder(base({ lines: [{ key: "k", productId: "p-isca", selections: {}, quantity }] }))).toThrow(
        CheckoutError,
      );
    }
  });

  it("recusa forma de pagamento desligada pela loja", () => {
    mutate((db) => {
      db.stores[0].payment.cash = false;
    });
    expect(() => placeOrder(base({ payment: { method: "cash" } }))).toThrow(CheckoutError);
  });

  it("recusa troco menor que o total", () => {
    expect(() => placeOrder(base({ payment: { method: "cash", changeFor: 5000 } }))).toThrow(CheckoutError);
  });

  it("recusa cliente sem nome, e entrega/retirada sem WhatsApp válido", () => {
    expect(() => placeOrder(base({ customer: { name: "  ", phone: "81999990000" } }))).toThrow(CheckoutError);
    expect(() => placeOrder(base({ customer: { name: "Ana", phone: "123" } }))).toThrow(CheckoutError);
  });

  it("recusa entrega sem rua ou número", () => {
    expect(() =>
      placeOrder(base({ mode: "delivery", delivery: { regionId: "r-centro", street: " ", number: "10" } })),
    ).toThrow(CheckoutError);
  });

  it("recusa bairro desativado", () => {
    expect(() =>
      placeOrder(base({ mode: "delivery", delivery: { regionId: "r-ilha", street: "Rua A", number: "1" } })),
    ).toThrow(CheckoutError);
  });

  it("pedido na mesa não exige WhatsApp, mas exige mesa válida", () => {
    const ok = placeOrder(base({ mode: "table", tableNumber: 3, customer: { name: "Mesa", phone: "" } }));
    expect(ok.tableNumber).toBe(3);
    expect(() => placeOrder(base({ mode: "table", tableNumber: 99, customer: { name: "Mesa", phone: "" } }))).toThrow(
      CheckoutError,
    );
  });

  it("numera os pedidos em sequência", () => {
    const a = placeOrder(base());
    const b = placeOrder(base());
    expect(b.number).toBe(a.number + 1);
  });
});

describe("andamento do pedido", () => {
  it("avança pelo fluxo e não cancela depois de sair para entrega", () => {
    const order = placeOrder(base({ mode: "delivery", delivery: { regionId: "r-centro", street: "Rua A", number: "1" } }));
    advanceOrder(order.id); // em preparo
    advanceOrder(order.id); // pronto
    advanceOrder(order.id); // a caminho
    cancelOrder(order.id);
    const saved = getDb().orders.find((o) => o.id === order.id)!;
    expect(saved.status).toBe("a_caminho");
    expect(saved.history.map((h) => h.status)).toEqual(["novo", "em_preparo", "pronto", "a_caminho"]);
  });
});

describe("cardápio de exemplo", () => {
  it("adiciona uma vez e não duplica num segundo clique", async () => {
    await signUp({ name: "Dono", email: "dono@exemplo.local", password: "senha-segura-1", storeName: "Bar Novo" });
    const storeId = getDb().stores.find((s) => s.name === "Bar Novo")!.id;
    expect(fillSampleMenu(storeId)).toBe(true);
    expect(fillSampleMenu(storeId)).toBe(false);
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
