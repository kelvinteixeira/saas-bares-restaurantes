// Conversão entre as linhas do Supabase (snake_case) e os tipos do app (src/lib/types.ts).
// O esquema está em supabase/migrations/001_inicial.sql.

import type { Category, Order, Product, Store, WeeklyHours } from "@/lib/types";

export interface StoreRow {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string;
  phone: string;
  address: Partial<Store["address"]>;
  brand_color: string;
  logo_url: string | null;
  timezone: string;
  hours: Record<string, { open: string; close: string }[]>;
  manual_status: Store["manualStatus"];
  delivery: Partial<Store["delivery"]>;
  pickup: Partial<Store["pickup"]>;
  table_service: Partial<Store["table"]>;
  payment: Partial<Store["payment"]>;
  next_order_number: number;
  created_at: string;
}

export interface CategoryRow {
  id: string;
  store_id: string;
  name: string;
  position: number;
  visible: boolean;
}

export interface ProductRow {
  id: string;
  store_id: string;
  category_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string | null;
  available: boolean;
  position: number;
  option_groups: Product["optionGroups"];
}

export interface OrderRow {
  id: string;
  store_id: string;
  number: number;
  created_at: string;
  promised_at: string;
  status: Order["status"];
  history: Order["history"];
  mode: Order["mode"];
  customer: Order["customer"];
  delivery: Order["delivery"] | null;
  table_number: number | null;
  items: Order["items"];
  subtotal: number;
  delivery_fee: number;
  total: number;
  payment: Order["payment"];
  notes: string | null;
}

function toHours(raw: StoreRow["hours"]): WeeklyHours {
  const hours = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } as WeeklyHours;
  for (let d = 0; d <= 6; d++) hours[d as keyof WeeklyHours] = raw?.[String(d)] ?? [];
  return hours;
}

export function rowToStore(r: StoreRow): Store {
  return {
    id: r.id,
    ownerId: r.owner_id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    phone: r.phone,
    address: { street: "", number: "", district: "", city: "", state: "", ...r.address },
    brandColor: r.brand_color,
    logo: r.logo_url ?? undefined,
    hours: toHours(r.hours),
    manualStatus: r.manual_status,
    delivery: { enabled: false, minOrder: 0, etaMin: 30, etaMax: 50, regions: [], ...r.delivery },
    pickup: { enabled: true, etaMin: 20, etaMax: 30, ...r.pickup },
    table: { enabled: false, count: 10, ...r.table_service },
    payment: { pix: true, card: true, cash: true, ...r.payment },
    nextOrderNumber: r.next_order_number,
    createdAt: r.created_at,
  };
}

/** Campos que o dono pode mudar (dono, slug só pelas regras, número e data ficam com o banco). */
export function storeToUpdate(s: Store) {
  const hours: StoreRow["hours"] = {};
  for (let d = 0; d <= 6; d++) hours[String(d)] = s.hours[d as keyof WeeklyHours] ?? [];
  return {
    slug: s.slug,
    name: s.name,
    description: s.description,
    phone: s.phone,
    address: s.address,
    brand_color: s.brandColor,
    logo_url: s.logo ?? null,
    hours,
    manual_status: s.manualStatus,
    delivery: s.delivery,
    pickup: s.pickup,
    table_service: s.table,
    payment: s.payment,
  };
}

export function rowToCategory(r: CategoryRow): Category {
  return { id: r.id, storeId: r.store_id, name: r.name, position: r.position, visible: r.visible };
}

export function categoryToRow(c: Category): CategoryRow {
  return { id: c.id, store_id: c.storeId, name: c.name, position: c.position, visible: c.visible };
}

export function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id,
    storeId: r.store_id,
    categoryId: r.category_id,
    name: r.name,
    description: r.description,
    price: r.price,
    image: r.image_url ?? undefined,
    available: r.available,
    position: r.position,
    optionGroups: r.option_groups ?? [],
  };
}

export function productToRow(p: Product): ProductRow {
  return {
    id: p.id,
    store_id: p.storeId,
    category_id: p.categoryId,
    name: p.name,
    description: p.description,
    price: p.price,
    image_url: p.image ?? null,
    available: p.available,
    position: p.position,
    option_groups: p.optionGroups,
  };
}

export function rowToOrder(r: OrderRow): Order {
  return {
    id: r.id,
    storeId: r.store_id,
    number: r.number,
    createdAt: r.created_at,
    promisedAt: r.promised_at,
    status: r.status,
    history: r.history ?? [],
    mode: r.mode,
    customer: r.customer,
    delivery: r.delivery ?? undefined,
    tableNumber: r.table_number ?? undefined,
    items: r.items ?? [],
    subtotal: r.subtotal,
    deliveryFee: r.delivery_fee,
    total: r.total,
    payment: r.payment,
    notes: r.notes ?? undefined,
  };
}

export function orderToRow(o: Order): OrderRow {
  return {
    id: o.id,
    store_id: o.storeId,
    number: o.number,
    created_at: o.createdAt,
    promised_at: o.promisedAt,
    status: o.status,
    history: o.history,
    mode: o.mode,
    customer: o.customer,
    delivery: o.delivery ?? null,
    table_number: o.tableNumber ?? null,
    items: o.items,
    subtotal: o.subtotal,
    delivery_fee: o.deliveryFee,
    total: o.total,
    payment: o.payment,
    notes: o.notes ?? null,
  };
}
