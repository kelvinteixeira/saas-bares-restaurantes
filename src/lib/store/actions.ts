"use client";

// Todas as escritas passam por aqui. Na fase 2 cada função vira uma chamada ao backend
// (Server Action ou RPC do Supabase) com as mesmas entradas e saídas.

import type {
  Category,
  Db,
  ManualStatus,
  Order,
  OrderMode,
  PaymentMethod,
  Product,
  Store,
} from "@/lib/types";
import { mutate } from "@/lib/store/db";
import { newId, seededRandom } from "@/lib/ids";
import { applyStatus, canCancel, nextStatus } from "@/lib/domain/orders";
import { deliveryFee, unitPrice, validateSelections, type CartLine } from "@/lib/domain/pricing";
import { onlyDigits } from "@/lib/format";
import { buildOrderItem, demoCategories, demoProducts, demoStore, randomOrder } from "@/lib/seed";
import { isStoreOpen } from "@/lib/domain/hours";

export function currentAccount(db: Db) {
  return db.session ? db.accounts.find((a) => a.id === db.session!.accountId) ?? null : null;
}

export function ownerStore(db: Db, accountId: string) {
  return db.stores.find((s) => s.ownerId === accountId) ?? null;
}

export function storeBySlug(db: Db, slug: string) {
  return db.stores.find((s) => s.slug === slug) ?? null;
}

function findStore(db: Db, storeId: string): Store {
  const store = db.stores.find((s) => s.id === storeId);
  if (!store) throw new Error("Loja não encontrada");
  return store;
}

// ---------- Loja ----------

export function updateStore(storeId: string, change: (store: Store) => void) {
  mutate((db) => change(findStore(db, storeId)));
}

export function setManualStatus(storeId: string, status: ManualStatus) {
  updateStore(storeId, (s) => {
    s.manualStatus = status;
  });
}

// ---------- Categorias ----------

export function addCategory(storeId: string, name: string): string {
  return mutate((db) => {
    const position = db.categories.filter((c) => c.storeId === storeId).length;
    const category: Category = { id: newId(), storeId, name, position, visible: true };
    db.categories.push(category);
    return category.id;
  });
}

export function updateCategory(id: string, change: (c: Category) => void) {
  mutate((db) => {
    const c = db.categories.find((x) => x.id === id);
    if (c) change(c);
  });
}

/** Apaga a categoria e os produtos dela. */
export function deleteCategory(id: string) {
  mutate((db) => {
    db.categories = db.categories.filter((c) => c.id !== id);
    db.products = db.products.filter((p) => p.categoryId !== id);
  });
}

function reorder<T extends { id: string; position: number }>(list: T[], id: string, direction: -1 | 1) {
  const sorted = [...list].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((x) => x.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return;
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  sorted.forEach((x, index) => {
    x.position = index;
  });
}

export function moveCategory(storeId: string, id: string, direction: -1 | 1) {
  mutate((db) => reorder(db.categories.filter((c) => c.storeId === storeId), id, direction));
}

// ---------- Produtos ----------

export function saveProduct(product: Product) {
  mutate((db) => {
    const i = db.products.findIndex((p) => p.id === product.id);
    if (i >= 0) {
      const previous = db.products[i];
      if (previous.categoryId !== product.categoryId) {
        product.position = db.products.filter((p) => p.categoryId === product.categoryId).length;
      }
      db.products[i] = product;
    } else {
      product.position = db.products.filter((p) => p.categoryId === product.categoryId).length;
      db.products.push(product);
    }
  });
}

export function newProduct(storeId: string, categoryId: string): Product {
  return {
    id: newId(),
    storeId,
    categoryId,
    name: "",
    description: "",
    price: 0,
    available: true,
    position: 0,
    optionGroups: [],
  };
}

export function deleteProduct(id: string) {
  mutate((db) => {
    db.products = db.products.filter((p) => p.id !== id);
  });
}

export function setProductAvailable(id: string, available: boolean) {
  mutate((db) => {
    const p = db.products.find((x) => x.id === id);
    if (p) p.available = available;
  });
}

export function moveProduct(categoryId: string, id: string, direction: -1 | 1) {
  mutate((db) => reorder(db.products.filter((p) => p.categoryId === categoryId), id, direction));
}

/**
 * Copia o cardápio de exemplo (5 categorias, 17 itens com opções) para a loja, com ids novos.
 * Se a loja ainda não tem bairros, também liga a entrega com bairros de exemplo e 10 mesas,
 * para dar para testar todas as modalidades no cardápio público.
 */
export function fillSampleMenu(storeId: string): boolean {
  return mutate((db) => {
    const store = findStore(db, storeId);
    // Já adicionado antes (todas as categorias de exemplo existem): não duplica.
    const existing = new Set(db.categories.filter((c) => c.storeId === storeId).map((c) => c.name));
    if (demoCategories().every((c) => existing.has(c.name))) return false;
    const offset = db.categories.filter((c) => c.storeId === storeId).length;
    const categoryIds = new Map<string, string>();
    for (const c of demoCategories()) {
      const id = newId();
      categoryIds.set(c.id, id);
      db.categories.push({ ...c, id, storeId, position: offset + c.position });
    }
    for (const p of demoProducts()) {
      db.products.push({
        ...p,
        id: newId(),
        storeId,
        categoryId: categoryIds.get(p.categoryId)!,
        optionGroups: p.optionGroups.map((g) => ({
          ...g,
          id: newId(),
          options: g.options.map((o) => ({ ...o, id: newId() })),
        })),
      });
    }
    if (store.delivery.regions.length === 0) {
      const sample = demoStore(new Date()).delivery;
      store.delivery = { ...sample, regions: sample.regions.map((r) => ({ ...r, id: newId() })) };
    }
    if (!store.table.enabled) store.table = { enabled: true, count: 10 };
    return true;
  });
}

// ---------- Pedidos ----------

export function advanceOrder(orderId: string) {
  mutate((db) => {
    const i = db.orders.findIndex((o) => o.id === orderId);
    if (i < 0) return;
    const next = nextStatus(db.orders[i]);
    if (next) db.orders[i] = applyStatus(db.orders[i], next, new Date());
  });
}

export function cancelOrder(orderId: string) {
  mutate((db) => {
    const i = db.orders.findIndex((o) => o.id === orderId);
    if (i < 0 || !canCancel(db.orders[i])) return;
    db.orders[i] = applyStatus(db.orders[i], "cancelado", new Date());
  });
}

export interface CheckoutInput {
  storeId: string;
  mode: OrderMode;
  lines: CartLine[];
  customer: { name: string; phone: string };
  delivery?: { regionId: string; street: string; number: string; complement?: string; reference?: string };
  tableNumber?: number;
  payment: { method: PaymentMethod; changeFor?: number };
  notes?: string;
}

export class CheckoutError extends Error {}

/** Mesmo limite da tela do item. */
export const MAX_ITEM_QUANTITY = 50;

/** Cria o pedido validando no "servidor" o que o cliente já validou na tela. */
export function placeOrder(input: CheckoutInput): Order {
  return mutate((db) => {
    const store = findStore(db, input.storeId);
    const now = new Date();
    if (!isStoreOpen(store, now)) throw new CheckoutError("A loja fechou enquanto você montava o pedido.");
    if (!input.lines.length) throw new CheckoutError("A sacola está vazia.");

    // O servidor nunca confia na tela: confere cliente, pagamento, itens e opções de novo.
    const customerName = input.customer.name.trim();
    const customerPhone = onlyDigits(input.customer.phone);
    if (!customerName) throw new CheckoutError("Informe seu nome.");
    if (input.mode !== "table" && (customerPhone.length < 10 || customerPhone.length > 11)) {
      throw new CheckoutError("Informe um WhatsApp com DDD.");
    }
    if (!store.payment[input.payment.method]) throw new CheckoutError("Esta forma de pagamento não está disponível.");

    const visibleCategories = new Set(db.categories.filter((c) => c.storeId === store.id && c.visible).map((c) => c.id));
    const changed = "Um item da sacola mudou no cardápio. Remova e adicione de novo.";
    const items = input.lines.map((line) => {
      const product = db.products.find((p) => p.id === line.productId && p.storeId === store.id);
      if (!product || !product.available || !visibleCategories.has(product.categoryId)) {
        throw new CheckoutError("Um item da sacola não está mais disponível.");
      }
      if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_ITEM_QUANTITY) {
        throw new CheckoutError("Quantidade inválida em um item da sacola.");
      }
      for (const [groupId, optionIds] of Object.entries(line.selections)) {
        const group = product.optionGroups.find((g) => g.id === groupId);
        if (!group || new Set(optionIds).size !== optionIds.length) throw new CheckoutError(changed);
        for (const id of optionIds) {
          const option = group.options.find((o) => o.id === id);
          if (!option) throw new CheckoutError(changed);
          if (!option.available) throw new CheckoutError(`A opção "${option.name}" de ${product.name} acabou.`);
        }
      }
      if (Object.keys(validateSelections(product, line.selections)).length) throw new CheckoutError(changed);
      const item = buildOrderItem(product, line.selections, line.quantity);
      item.unitPrice = unitPrice(product, line.selections);
      if (line.notes) item.notes = line.notes;
      return item;
    });
    const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);

    let fee = 0;
    let delivery: Order["delivery"];
    let eta = 25;
    if (input.mode === "delivery") {
      if (!store.delivery.enabled) throw new CheckoutError("Esta loja não está entregando agora.");
      const regionFee = deliveryFee(store, input.delivery?.regionId);
      const region = store.delivery.regions.find((r) => r.id === input.delivery?.regionId);
      if (regionFee === null || !region || !input.delivery) throw new CheckoutError("Escolha um bairro atendido.");
      if (!input.delivery.street.trim() || !input.delivery.number.trim()) throw new CheckoutError("Informe rua e número.");
      if (subtotal < store.delivery.minOrder) throw new CheckoutError("O pedido não chegou ao valor mínimo para entrega.");
      fee = regionFee;
      delivery = {
        ...input.delivery,
        street: input.delivery.street.trim(),
        number: input.delivery.number.trim(),
        regionName: region.name,
      };
      eta = store.delivery.etaMax;
    } else if (input.mode === "pickup") {
      if (!store.pickup.enabled) throw new CheckoutError("Esta loja não está com retirada agora.");
      eta = store.pickup.etaMax;
    } else if (!store.table.enabled || !input.tableNumber || input.tableNumber > store.table.count) {
      throw new CheckoutError("Mesa inválida. Leia o QR code da mesa de novo.");
    }

    const total = subtotal + fee;
    if (input.payment.method === "cash" && input.payment.changeFor !== undefined && input.payment.changeFor < total) {
      throw new CheckoutError("O troco precisa ser maior ou igual ao total do pedido.");
    }

    const order: Order = {
      id: newId(),
      storeId: store.id,
      number: store.nextOrderNumber++,
      createdAt: now.toISOString(),
      promisedAt: new Date(now.getTime() + eta * 60000).toISOString(),
      status: "novo",
      history: [{ status: "novo", at: now.toISOString() }],
      mode: input.mode,
      customer: { name: customerName, phone: customerPhone },
      delivery,
      tableNumber: input.mode === "table" ? input.tableNumber : undefined,
      items,
      subtotal,
      deliveryFee: fee,
      total,
      payment: input.payment.method === "cash" ? input.payment : { method: input.payment.method },
      notes: input.notes?.trim() || undefined,
    };
    db.orders.push(order);
    return order;
  });
}

/** Cria um pedido aleatório a partir do cardápio da loja, para testar o painel. */
export function simulateOrder(storeId: string): Order | null {
  return mutate((db) => {
    const store = findStore(db, storeId);
    const products = db.products.filter((p) => p.storeId === storeId && p.available);
    if (!products.length) return null;
    const now = new Date();
    const order = randomOrder(seededRandom(now.getTime() % 2147483647), store, products, now, store.nextOrderNumber++, "novo");
    order.id = newId();
    db.orders.push(order);
    return order;
  });
}
