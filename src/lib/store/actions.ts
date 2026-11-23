"use client";

// Todas as escritas passam por aqui, e todas são assíncronas.
// - Loja do Supabase (camada remota): grava no banco e atualiza a camada remota em memória.
// - Loja local (demonstração, ou app sem Supabase configurado): grava no localStorage.
// As telas não precisam saber qual das duas é.

import type {
  Account,
  Category,
  Db,
  ManualStatus,
  Order,
  OrderMode,
  PaymentMethod,
  Product,
  Store,
} from "@/lib/types";
import { getDb, getRemote, mutate, setRemote } from "@/lib/store/db";
import { newId, seededRandom } from "@/lib/ids";
import { applyStatus, canCancel, nextStatus } from "@/lib/domain/orders";
import { deliveryFee, unitPrice, validateSelections, type CartLine } from "@/lib/domain/pricing";
import { onlyDigits } from "@/lib/format";
import { buildOrderItem, demoCategories, demoProducts, demoStore, randomOrder } from "@/lib/seed";
import { isStoreOpen } from "@/lib/domain/hours";
import { getSupabase } from "@/lib/supabase/client";
import {
  friendly,
  isRemoteStore,
  remoteUpsertCategory,
  remoteUpsertOrder,
  remoteUpsertProduct,
  remoteUpsertStore,
  uploadDataUrl,
} from "@/lib/store/remote";
import {
  categoryToRow,
  orderToRow,
  productToRow,
  rowToCategory,
  rowToOrder,
  rowToProduct,
  rowToStore,
  storeToUpdate,
  type CategoryRow,
  type OrderRow,
  type ProductRow,
  type StoreRow,
} from "@/lib/store/mappers";

export function currentAccount(db: Db) {
  return db.session ? db.accounts.find((a) => a.id === db.session!.accountId) ?? null : null;
}

/** Loja de quem está logado: a da equipe (Supabase) ou, na simulação local, a que a conta criou. */
export function ownerStore(db: Db, account: Account) {
  if (account.storeId) return db.stores.find((s) => s.id === account.storeId) ?? null;
  return db.stores.find((s) => s.ownerId === account.id) ?? null;
}

export function storeBySlug(db: Db, slug: string) {
  return db.stores.find((s) => s.slug === slug) ?? null;
}

function findStore(db: Db, storeId: string): Store {
  const store = db.stores.find((s) => s.id === storeId);
  if (!store) throw new Error("Loja não encontrada");
  return store;
}

const isDataUrl = (value?: string) => Boolean(value?.startsWith("data:"));

// ---------- Loja ----------

export async function updateStore(storeId: string, change: (store: Store) => void) {
  if (!isRemoteStore(storeId)) {
    mutate((db) => change(findStore(db, storeId)));
    return;
  }
  const next = structuredClone(findStore(getDb(), storeId));
  change(next);
  if (isDataUrl(next.logo)) next.logo = await uploadDataUrl(storeId, "logo", next.logo!);
  const { data, error } = await getSupabase()
    .from("stores")
    .update(storeToUpdate(next))
    .eq("id", storeId)
    .select()
    .single<StoreRow>();
  if (error?.code === "23505") throw new Error("Outra loja já usa este endereço.");
  if (error || !data) throw friendly(error, "Não foi possível salvar a loja.");
  remoteUpsertStore(rowToStore(data));
}

export async function setManualStatus(storeId: string, status: ManualStatus) {
  await updateStore(storeId, (s) => {
    s.manualStatus = status;
  });
}

// ---------- Categorias ----------

export async function addCategory(storeId: string, name: string): Promise<string> {
  const position = getDb().categories.filter((c) => c.storeId === storeId).length;
  const category: Category = { id: newId(), storeId, name, position, visible: true };
  if (!isRemoteStore(storeId)) {
    mutate((db) => {
      db.categories.push(category);
    });
    return category.id;
  }
  const { data, error } = await getSupabase().from("categories").insert(categoryToRow(category)).select().single<CategoryRow>();
  if (error || !data) throw friendly(error, "Não foi possível criar a categoria.");
  remoteUpsertCategory(rowToCategory(data));
  return data.id;
}

export async function updateCategory(id: string, change: (c: Category) => void) {
  const current = getDb().categories.find((c) => c.id === id);
  if (!current) return;
  if (!isRemoteStore(current.storeId)) {
    mutate((db) => {
      const c = db.categories.find((x) => x.id === id);
      if (c) change(c);
    });
    return;
  }
  const next = { ...current };
  change(next);
  const { data, error } = await getSupabase().from("categories").update(categoryToRow(next)).eq("id", id).select().single<CategoryRow>();
  if (error || !data) throw friendly(error, "Não foi possível salvar a categoria.");
  remoteUpsertCategory(rowToCategory(data));
}

/** Apaga a categoria e os produtos dela. */
export async function deleteCategory(id: string) {
  const current = getDb().categories.find((c) => c.id === id);
  if (!current) return;
  if (!isRemoteStore(current.storeId)) {
    mutate((db) => {
      db.categories = db.categories.filter((c) => c.id !== id);
      db.products = db.products.filter((p) => p.categoryId !== id);
    });
    return;
  }
  const { error } = await getSupabase().from("categories").delete().eq("id", id);
  if (error) throw friendly(error, "Não foi possível apagar a categoria.");
  setRemote((r) => ({
    ...r,
    categories: r.categories.filter((c) => c.id !== id),
    products: r.products.filter((p) => p.categoryId !== id),
  }));
}

/** Nova ordem depois de trocar um item de lugar com o vizinho; só devolve os que mudaram. */
function reorder<T extends { id: string; position: number }>(list: T[], id: string, direction: -1 | 1): T[] {
  const sorted = [...list].sort((a, b) => a.position - b.position).map((x) => ({ ...x }));
  const i = sorted.findIndex((x) => x.id === id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= sorted.length) return [];
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  return sorted.filter((x, index) => {
    const changed = x.position !== index;
    x.position = index;
    return changed;
  });
}

export async function moveCategory(storeId: string, id: string, direction: -1 | 1) {
  const changed = reorder(getDb().categories.filter((c) => c.storeId === storeId), id, direction);
  if (!changed.length) return;
  if (!isRemoteStore(storeId)) {
    mutate((db) => {
      for (const c of changed) {
        const target = db.categories.find((x) => x.id === c.id);
        if (target) target.position = c.position;
      }
    });
    return;
  }
  const sb = getSupabase();
  const results = await Promise.all(changed.map((c) => sb.from("categories").update({ position: c.position }).eq("id", c.id)));
  const failed = results.find((r) => r.error);
  if (failed) throw friendly(failed.error, "Não foi possível mudar a ordem.");
  for (const c of changed) remoteUpsertCategory(c);
}

// ---------- Produtos ----------

export async function saveProduct(product: Product) {
  const db = getDb();
  const previous = db.products.find((p) => p.id === product.id);
  if (!previous || previous.categoryId !== product.categoryId) {
    product.position = db.products.filter((p) => p.categoryId === product.categoryId && p.id !== product.id).length;
  }
  if (!isRemoteStore(product.storeId)) {
    mutate((local) => {
      const i = local.products.findIndex((p) => p.id === product.id);
      if (i >= 0) local.products[i] = product;
      else local.products.push(product);
    });
    return;
  }
  const next = { ...product };
  if (isDataUrl(next.image)) next.image = await uploadDataUrl(product.storeId, `item-${product.id}`, next.image!);
  const { data, error } = await getSupabase().from("products").upsert(productToRow(next)).select().single<ProductRow>();
  if (error || !data) throw friendly(error, "Não foi possível salvar o item.");
  remoteUpsertProduct(rowToProduct(data));
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

export async function deleteProduct(id: string) {
  const current = getDb().products.find((p) => p.id === id);
  if (!current) return;
  if (!isRemoteStore(current.storeId)) {
    mutate((db) => {
      db.products = db.products.filter((p) => p.id !== id);
    });
    return;
  }
  const { error } = await getSupabase().from("products").delete().eq("id", id);
  if (error) throw friendly(error, "Não foi possível apagar o item.");
  setRemote((r) => ({ ...r, products: r.products.filter((p) => p.id !== id) }));
}

export async function setProductAvailable(id: string, available: boolean) {
  const current = getDb().products.find((p) => p.id === id);
  if (!current) return;
  if (!isRemoteStore(current.storeId)) {
    mutate((db) => {
      const p = db.products.find((x) => x.id === id);
      if (p) p.available = available;
    });
    return;
  }
  const { data, error } = await getSupabase().from("products").update({ available }).eq("id", id).select().single<ProductRow>();
  if (error || !data) throw friendly(error, "Não foi possível mudar o item.");
  remoteUpsertProduct(rowToProduct(data));
}

export async function moveProduct(categoryId: string, id: string, direction: -1 | 1) {
  const list = getDb().products.filter((p) => p.categoryId === categoryId);
  const changed = reorder(list, id, direction);
  if (!changed.length) return;
  if (!isRemoteStore(list[0].storeId)) {
    mutate((db) => {
      for (const p of changed) {
        const target = db.products.find((x) => x.id === p.id);
        if (target) target.position = p.position;
      }
    });
    return;
  }
  const sb = getSupabase();
  const results = await Promise.all(changed.map((p) => sb.from("products").update({ position: p.position }).eq("id", p.id)));
  const failed = results.find((r) => r.error);
  if (failed) throw friendly(failed.error, "Não foi possível mudar a ordem.");
  for (const p of changed) remoteUpsertProduct(p);
}

/**
 * Copia o cardápio de exemplo (5 categorias, 17 itens com opções) para a loja, com ids novos.
 * Se a loja ainda não tem bairros, também liga a entrega com bairros de exemplo e 10 mesas,
 * para dar para testar todas as modalidades no cardápio público.
 * Devolve false se o cardápio de exemplo já estava na loja.
 */
export async function fillSampleMenu(storeId: string): Promise<boolean> {
  const db = getDb();
  const store = findStore(db, storeId);
  const existing = new Set(db.categories.filter((c) => c.storeId === storeId).map((c) => c.name));
  if (demoCategories().every((c) => existing.has(c.name))) return false;

  const offset = db.categories.filter((c) => c.storeId === storeId).length;
  const categoryIds = new Map<string, string>();
  const categories: Category[] = demoCategories().map((c) => {
    const id = newId();
    categoryIds.set(c.id, id);
    return { ...c, id, storeId, position: offset + c.position };
  });
  const products: Product[] = demoProducts().map((p) => ({
    ...p,
    id: newId(),
    storeId,
    categoryId: categoryIds.get(p.categoryId)!,
    optionGroups: p.optionGroups.map((g) => ({
      ...g,
      id: newId(),
      options: g.options.map((o) => ({ ...o, id: newId() })),
    })),
  }));
  const storeChange = (s: Store) => {
    if (s.delivery.regions.length === 0) {
      const sample = demoStore(new Date()).delivery;
      s.delivery = { ...sample, regions: sample.regions.map((r) => ({ ...r, id: newId() })) };
    }
    if (!s.table.enabled) s.table = { enabled: true, count: 10 };
  };

  if (!isRemoteStore(storeId)) {
    mutate((local) => {
      local.categories.push(...categories);
      local.products.push(...products);
      storeChange(findStore(local, storeId));
    });
    return true;
  }

  const sb = getSupabase();
  const cats = await sb.from("categories").insert(categories.map(categoryToRow)).select();
  if (cats.error) throw friendly(cats.error, "Não foi possível adicionar o cardápio de exemplo.");
  const prods = await sb.from("products").insert(products.map(productToRow)).select();
  if (prods.error) throw friendly(prods.error, "Não foi possível adicionar o cardápio de exemplo.");
  setRemote((r) => ({
    ...r,
    categories: [...r.categories, ...((cats.data ?? []) as CategoryRow[]).map(rowToCategory)],
    products: [...r.products, ...((prods.data ?? []) as ProductRow[]).map(rowToProduct)],
  }));
  const changedStore = structuredClone(store);
  storeChange(changedStore);
  if (JSON.stringify(changedStore) !== JSON.stringify(store)) await updateStore(storeId, storeChange);
  return true;
}

// ---------- Pedidos ----------

async function saveOrderStatus(order: Order, next: Order) {
  if (!isRemoteStore(order.storeId)) {
    mutate((db) => {
      const i = db.orders.findIndex((o) => o.id === order.id);
      if (i >= 0) db.orders[i] = next;
    });
    return;
  }
  const { data, error } = await getSupabase()
    .from("orders")
    .update({ status: next.status, history: next.history })
    .eq("id", order.id)
    .select()
    .single<OrderRow>();
  if (error || !data) throw friendly(error, "Não foi possível mudar o pedido.");
  remoteUpsertOrder(rowToOrder(data));
}

export async function advanceOrder(orderId: string) {
  const order = getDb().orders.find((o) => o.id === orderId);
  if (!order) return;
  const next = nextStatus(order);
  if (next) await saveOrderStatus(order, applyStatus(order, next, new Date()));
}

export async function cancelOrder(orderId: string) {
  const order = getDb().orders.find((o) => o.id === orderId);
  if (!order || !canCancel(order)) return;
  await saveOrderStatus(order, applyStatus(order, "cancelado", new Date()));
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

/**
 * Cria o pedido. Na loja do Supabase quem confere e calcula é a função place_order do banco;
 * na loja local, as mesmas regras abaixo.
 */
export async function placeOrder(input: CheckoutInput): Promise<Order> {
  if (isRemoteStore(input.storeId)) {
    const { data, error } = await getSupabase().rpc("place_order", { payload: input });
    if (error || !data) throw new CheckoutError(friendly(error, "Não foi possível enviar o pedido.").message);
    const order = rowToOrder(data as OrderRow);
    remoteUpsertOrder(order);
    return order;
  }
  return mutate((db) => placeLocalOrder(db, input));
}

function placeLocalOrder(db: Db, input: CheckoutInput): Order {
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
}

/** Cria um pedido aleatório a partir do cardápio da loja, para testar o painel. */
export async function simulateOrder(storeId: string): Promise<Order | null> {
  const db = getDb();
  const store = findStore(db, storeId);
  const products = db.products.filter((p) => p.storeId === storeId && p.available);
  if (!products.length) return null;
  const now = new Date();

  if (!isRemoteStore(storeId)) {
    return mutate((local) => {
      const s = findStore(local, storeId);
      const order = randomOrder(seededRandom(now.getTime() % 2147483647), s, products, now, s.nextOrderNumber++, "novo");
      order.id = newId();
      local.orders.push(order);
      return order;
    });
  }

  const sb = getSupabase();
  const { data: number, error: numberError } = await sb.rpc("take_order_number", { p_store: storeId });
  if (numberError || typeof number !== "number") throw friendly(numberError, "Não foi possível simular o pedido.");
  const order = randomOrder(seededRandom(now.getTime() % 2147483647), store, products, now, number, "novo");
  order.id = newId();
  const { data, error } = await sb.from("orders").insert(orderToRow(order)).select().single<OrderRow>();
  if (error || !data) throw friendly(error, "Não foi possível simular o pedido.");
  const saved = rowToOrder(data);
  remoteUpsertOrder(saved);
  return saved;
}

/** Para a tela saber se a sessão atual é do Supabase. */
export function hasRemoteSession(): boolean {
  return Boolean(getRemote().account);
}
