// Conversão entre as linhas do Supabase (snake_case) e os tipos do app (src/lib/types.ts).
// O esquema está em supabase/migrations/001_inicial.sql.

import type { FiscalDocument, StoreFiscal, AbandonedCart, Driver, CashbackEntry, CashMovement, CashSession, Category, Coupon, Order, Payment, Product, Store, Tab, WeeklyHours } from "@/lib/types";

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
  /** Só existe depois do SQL 003. */
  service_fee?: Store["serviceFee"];
  /** Só existe depois do SQL 007. */
  cashback?: Store["cashback"];
  /** Só existe depois do SQL 008. */
  scheduling?: Store["scheduling"];
  /** Só existe depois do SQL 010. */
  tracking?: Store["tracking"];
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
  prep_station?: Product["prepStation"];
  /** Só existe depois do SQL 012. */
  fiscal?: Product["fiscal"] | null;
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
  /** Colunas do SQL 003. */
  tab_id?: string | null;
  source?: Order["source"];
  created_by?: string | null;
  /** Colunas do SQL 006. */
  discount?: number;
  coupon_id?: string | null;
  coupon_code?: string | null;
  /** Coluna do SQL 007. */
  cashback_used?: number;
  /** Coluna do SQL 008. */
  scheduled_for?: string | null;
  /** Colunas do SQL 009. */
  driver_id?: string | null;
  driver_pay?: number;
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
    serviceFee: r.service_fee ?? undefined,
    cashback: r.cashback ?? undefined,
    scheduling: r.scheduling ?? undefined,
    tracking: r.tracking ?? undefined,
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
    // Antes do SQL 003 a coluna não existe: só manda quando a loja já tem o valor.
    ...(s.serviceFee ? { service_fee: s.serviceFee } : {}),
    ...(s.cashback ? { cashback: s.cashback } : {}),
    ...(s.scheduling ? { scheduling: s.scheduling } : {}),
    ...(s.tracking ? { tracking: s.tracking } : {}),
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
    prepStation: r.prep_station ?? "kitchen",
    fiscal: r.fiscal ?? undefined,
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
    prep_station: p.prepStation ?? "kitchen",
    // Antes do SQL 012 a coluna não existe: só manda quando o item tem códigos fiscais.
    ...(p.fiscal ? { fiscal: p.fiscal } : {}),
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
    tabId: r.tab_id ?? undefined,
    source: r.source ?? undefined,
    createdBy: r.created_by ?? undefined,
    discount: r.discount || undefined,
    couponId: r.coupon_id ?? undefined,
    couponCode: r.coupon_code ?? undefined,
    cashbackUsed: r.cashback_used || undefined,
    scheduledFor: r.scheduled_for ?? undefined,
    driverId: r.driver_id ?? undefined,
    driverPay: r.driver_pay || undefined,
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
    ...(o.tabId ? { tab_id: o.tabId } : {}),
    ...(o.source ? { source: o.source } : {}),
    ...(o.createdBy ? { created_by: o.createdBy } : {}),
  };
}

export interface TabRow {
  id: string;
  store_id: string;
  table_number: number;
  status: Tab["status"];
  opened_by: string | null;
  opened_at: string;
  closed_by: string | null;
  closed_at: string | null;
  service_fee_rate: number;
  service_fee_removed: boolean;
  notes: string | null;
}

export function rowToTab(r: TabRow): Tab {
  return {
    id: r.id,
    storeId: r.store_id,
    tableNumber: r.table_number,
    status: r.status,
    openedBy: r.opened_by ?? undefined,
    openedAt: r.opened_at,
    closedBy: r.closed_by ?? undefined,
    closedAt: r.closed_at ?? undefined,
    serviceFeeRate: r.service_fee_rate,
    serviceFeeRemoved: r.service_fee_removed,
    notes: r.notes ?? undefined,
  };
}

// ---------- caixa (SQL 005) ----------

export interface CashSessionRow {
  id: string;
  store_id: string;
  status: CashSession["status"];
  opened_by: string | null;
  opened_at: string;
  opening_amount: number;
  closed_by: string | null;
  closed_at: string | null;
  counted_amount: number | null;
  expected_amount: number | null;
  notes: string | null;
}

export function rowToCashSession(r: CashSessionRow): CashSession {
  return {
    id: r.id,
    storeId: r.store_id,
    status: r.status,
    openedBy: r.opened_by ?? undefined,
    openedAt: r.opened_at,
    openingAmount: r.opening_amount,
    closedBy: r.closed_by ?? undefined,
    closedAt: r.closed_at ?? undefined,
    countedAmount: r.counted_amount ?? undefined,
    expectedAmount: r.expected_amount ?? undefined,
    notes: r.notes ?? undefined,
  };
}

export interface PaymentRow {
  id: string;
  store_id: string;
  cash_session_id: string;
  tab_id: string | null;
  order_id: string | null;
  method: Payment["method"];
  amount: number;
  change_given: number;
  created_by: string | null;
  created_at: string;
}

export function rowToPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    storeId: r.store_id,
    cashSessionId: r.cash_session_id,
    tabId: r.tab_id ?? undefined,
    orderId: r.order_id ?? undefined,
    method: r.method,
    amount: r.amount,
    changeGiven: r.change_given,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
  };
}

export interface CashMovementRow {
  id: string;
  store_id: string;
  cash_session_id: string;
  kind: CashMovement["kind"];
  amount: number;
  reason: string;
  created_by: string | null;
  created_at: string;
}

export function rowToCashMovement(r: CashMovementRow): CashMovement {
  return {
    id: r.id,
    storeId: r.store_id,
    cashSessionId: r.cash_session_id,
    kind: r.kind,
    amount: r.amount,
    reason: r.reason,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
  };
}

// ---------- cupons (SQL 006) ----------

export interface CouponRow {
  id: string;
  store_id: string;
  code: string;
  kind: Coupon["kind"];
  value: number;
  min_order: number;
  max_uses: number | null;
  once_per_customer: boolean;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
  created_at: string;
}

export function rowToCoupon(r: CouponRow): Coupon {
  return {
    id: r.id,
    storeId: r.store_id,
    code: r.code,
    kind: r.kind,
    value: r.value,
    minOrder: r.min_order,
    maxUses: r.max_uses ?? undefined,
    oncePerCustomer: r.once_per_customer,
    startsAt: r.starts_at ?? undefined,
    endsAt: r.ends_at ?? undefined,
    active: r.active,
    createdAt: r.created_at,
  };
}

export function couponToRow(c: Coupon): Omit<CouponRow, "created_at"> {
  return {
    id: c.id,
    store_id: c.storeId,
    code: c.code,
    kind: c.kind,
    value: c.value,
    min_order: c.minOrder,
    max_uses: c.maxUses ?? null,
    once_per_customer: c.oncePerCustomer,
    starts_at: c.startsAt ?? null,
    ends_at: c.endsAt ?? null,
    active: c.active,
  };
}

// ---------- cashback (SQL 007) ----------

export interface CashbackEntryRow {
  id: string;
  store_id: string;
  phone: string;
  order_id: string | null;
  kind: CashbackEntry["kind"];
  amount: number;
  created_at: string;
  expires_at: string | null;
}

export function rowToCashbackEntry(r: CashbackEntryRow): CashbackEntry {
  return {
    id: r.id,
    storeId: r.store_id,
    phone: r.phone,
    orderId: r.order_id ?? undefined,
    kind: r.kind,
    amount: r.amount,
    createdAt: r.created_at,
    expiresAt: r.expires_at ?? undefined,
  };
}

// ---------- entregadores (SQL 009) ----------

export interface DriverRow {
  id: string;
  store_id: string;
  name: string;
  phone: string;
  pay_kind: Driver["payKind"];
  pay_amount: number;
  active: boolean;
  created_at: string;
}

export function rowToDriver(r: DriverRow): Driver {
  return {
    id: r.id,
    storeId: r.store_id,
    name: r.name,
    phone: r.phone,
    payKind: r.pay_kind,
    payAmount: r.pay_amount,
    active: r.active,
    createdAt: r.created_at,
  };
}

export function driverToRow(d: Driver): Omit<DriverRow, "created_at"> {
  return {
    id: d.id,
    store_id: d.storeId,
    name: d.name,
    phone: d.phone,
    pay_kind: d.payKind,
    pay_amount: d.payAmount,
    active: d.active,
  };
}

// ---------- sacolas abandonadas (SQL 011) ----------

export interface CartRow {
  id: string;
  store_id: string;
  phone: string;
  name: string;
  items: AbandonedCart["items"];
  subtotal: number;
  mode: AbandonedCart["mode"] | null;
  status: AbandonedCart["status"];
  contacted_at: string | null;
  order_id: string | null;
  created_at: string;
  updated_at: string;
}

export function rowToCart(r: CartRow): AbandonedCart {
  return {
    id: r.id,
    storeId: r.store_id,
    phone: r.phone,
    name: r.name,
    items: r.items ?? [],
    subtotal: r.subtotal,
    mode: r.mode ?? undefined,
    status: r.status,
    contactedAt: r.contacted_at ?? undefined,
    orderId: r.order_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ---------- NFC-e (SQL 012) ----------

export interface StoreFiscalRow {
  store_id: string;
  enabled: boolean;
  environment: StoreFiscal["environment"];
  cnpj: string;
  ie: string;
  legal_name: string;
  regime: StoreFiscal["regime"];
  default_ncm: string;
  default_cfop: string;
  default_tax_code: string;
  provider_company_id: string | null;
  certificate_valid_until: string | null;
  updated_at: string;
}

export function rowToStoreFiscal(r: StoreFiscalRow): StoreFiscal {
  return {
    storeId: r.store_id,
    enabled: r.enabled,
    environment: r.environment,
    cnpj: r.cnpj,
    ie: r.ie,
    legalName: r.legal_name,
    regime: r.regime,
    defaultNcm: r.default_ncm,
    defaultCfop: r.default_cfop,
    defaultTaxCode: r.default_tax_code,
    providerCompanyId: r.provider_company_id ?? undefined,
    certificateValidUntil: r.certificate_valid_until ?? undefined,
    updatedAt: r.updated_at,
  };
}

/** O que a loja grava (cadastro no emissor e validade do certificado ficam com o servidor). */
export function storeFiscalToRow(f: StoreFiscal) {
  return {
    store_id: f.storeId,
    enabled: f.enabled,
    environment: f.environment,
    cnpj: f.cnpj,
    ie: f.ie,
    legal_name: f.legalName,
    regime: f.regime,
    default_ncm: f.defaultNcm,
    default_cfop: f.defaultCfop,
    default_tax_code: f.defaultTaxCode,
  };
}

export interface FiscalDocumentRow {
  id: string;
  store_id: string;
  order_id: string | null;
  /** Só existe depois do SQL 013. */
  tab_id?: string | null;
  environment: FiscalDocument["environment"];
  provider: string;
  status: FiscalDocument["status"];
  number: number | null;
  series: number | null;
  access_key: string | null;
  protocol: string | null;
  total: number;
  cpf: string | null;
  danfe_url: string | null;
  xml_url: string | null;
  message: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
}

export function rowToFiscalDocument(r: FiscalDocumentRow): FiscalDocument {
  return {
    id: r.id,
    storeId: r.store_id,
    orderId: r.order_id ?? undefined,
    tabId: r.tab_id ?? undefined,
    environment: r.environment,
    provider: r.provider,
    status: r.status,
    number: r.number ?? undefined,
    series: r.series ?? undefined,
    accessKey: r.access_key ?? undefined,
    protocol: r.protocol ?? undefined,
    total: r.total,
    cpf: r.cpf ?? undefined,
    danfeUrl: r.danfe_url ?? undefined,
    xmlUrl: r.xml_url ?? undefined,
    message: r.message ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    cancelledAt: r.cancelled_at ?? undefined,
  };
}
