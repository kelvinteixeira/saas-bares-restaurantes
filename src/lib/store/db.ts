"use client";

// Duas camadas de dados, vistas pelas telas como um documento só (useDb):
//
// - Local: um documento JSON no localStorage com a demonstração (Bar do Cais). Abas do mesmo
//   navegador recebem as mudanças pelo evento "storage". Sem Supabase configurado, tudo vive aqui.
// - Remota: em memória, com o que veio do Supabase (conta, loja do dono, lojas públicas abertas,
//   cardápio e pedidos). Preenchida e mantida por remote.ts; nunca é salva no localStorage.
//
// A sessão remota tem prioridade sobre a local.

import { useSyncExternalStore } from "react";
import type { Account, CashMovement, CashSession, Category, Db, Order, Payment, Product, Store, Tab } from "@/lib/types";
import { buildDemoDb, demoProducts, DEMO_STORE_ID, tabsForOpenTableOrders } from "@/lib/seed";
import { supabaseConfigured } from "@/lib/supabase/client";

export interface RemoteState {
  /** false até conferir se há sessão no Supabase (sempre true sem Supabase). */
  authResolved: boolean;
  account: Account | null;
  stores: Store[];
  categories: Category[];
  products: Product[];
  orders: Order[];
  tabs: Tab[];
  cashSessions: CashSession[];
  payments: Payment[];
  cashMovements: CashMovement[];
  /** Lojas públicas buscadas por endereço: "loading" ou "done" (achada ou não). */
  slugState: Record<string, "loading" | "done">;
  /** Pedidos buscados para acompanhamento: "loading" ou "done". */
  orderState: Record<string, "loading" | "done">;
}

export function emptyRemote(authResolved: boolean): RemoteState {
  return { authResolved, account: null, stores: [], categories: [], products: [], orders: [], tabs: [], cashSessions: [], payments: [], cashMovements: [], slugState: {}, orderState: {} };
}

let remote: RemoteState = emptyRemote(!supabaseConfigured());
let merged: Db | null = null;

const KEY = "comanda:db:v1";
let cache: Db | null = null;
const listeners = new Set<() => void>();

export class StorageFullError extends Error {
  constructor() {
    super("O navegador ficou sem espaço para salvar. Use fotos menores ou remova algumas.");
  }
}

function write(db: Db) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    throw new StorageFullError();
  }
}

// A paleta passou a ser a do Volpe Barber. Lojas que ainda estão com a cor padrão antiga
// (não escolhida pelo dono) passam para o laranja novo; cores escolhidas ficam como estão.
const OLD_DEFAULT_COLORS = new Set(["#0f4c5c", "#1f5f4a"]);
function migrateDefaultColors(db: Db) {
  let changed = false;
  for (const store of db.stores ?? []) {
    if (OLD_DEFAULT_COLORS.has(store.brandColor)) {
      store.brandColor = "#b84a00";
      changed = true;
    }
  }
  if (changed) {
    try {
      write(db);
    } catch {
      // sem espaço: a troca vale só nesta visita
    }
  }
}

/**
 * Uma vez só: põe a foto ilustrativa nos itens de exemplo que já existiam antes das fotos
 * (Bar do Cais e cardápios de exemplo adicionados em outras lojas). Itens criados pelo dono
 * não são tocados, e uma foto removida depois não volta.
 */
/** Setor de preparo nos itens de exemplo que já estavam salvos (bebidas prontas e do bar). */
function migratePrepStations(db: Db) {
  const KEY_DONE = "prep-stations-v1";
  if (db.migrations?.includes(KEY_DONE)) return;
  const samples = demoProducts();
  const byId = new Map(samples.map((p) => [p.id, p.prepStation]));
  const byText = new Map(samples.map((p) => [`${p.name}|${p.description}`, p.prepStation]));
  for (const p of db.products ?? []) {
    if (p.prepStation) continue;
    const station = p.storeId === DEMO_STORE_ID ? byId.get(p.id) : byText.get(`${p.name}|${p.description}`);
    if (station) p.prepStation = station;
  }
  db.migrations = [...(db.migrations ?? []), KEY_DONE];
  try {
    write(db);
  } catch {
    // sem espaço: tenta de novo na próxima visita
  }
}

/** Comandas de mesa (SQL 003): documentos antigos ganham as comandas das mesas em andamento. */
function migrateTabs(db: Db) {
  const KEY_DONE = "tabs-v1";
  if (db.migrations?.includes(KEY_DONE)) return;
  const tabs = db.tabs ?? [];
  for (const store of db.stores ?? []) tabsForOpenTableOrders(store, db.orders ?? [], tabs);
  db.tabs = tabs;
  db.migrations = [...(db.migrations ?? []), KEY_DONE];
  try {
    write(db);
  } catch {
    // sem espaço: tenta de novo na próxima visita
  }
}

function migrateDemoPhotos(db: Db) {
  const KEY_DONE = "demo-photos-v1";
  if (db.migrations?.includes(KEY_DONE)) return;
  const samples = demoProducts();
  const byId = new Map(samples.map((p) => [p.id, p.image]));
  const byText = new Map(samples.map((p) => [`${p.name}|${p.description}`, p.image]));
  for (const p of db.products ?? []) {
    if (p.image) continue;
    const image = p.storeId === DEMO_STORE_ID ? byId.get(p.id) : byText.get(`${p.name}|${p.description}`);
    if (image) p.image = image;
  }
  db.migrations = [...(db.migrations ?? []), KEY_DONE];
  try {
    write(db);
  } catch {
    // sem espaço: tenta de novo na próxima visita
  }
}

function readLocal(): Db {
  if (cache) return cache;
  let db: Db | null = null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) db = JSON.parse(raw) as Db;
  } catch {
    db = null;
  }
  if (db) migrateDefaultColors(db);
  if (db) {
    migrateDemoPhotos(db);
    migratePrepStations(db);
    migrateTabs(db);
  }
  if (!db || db.version !== 1) {
    db = buildDemoDb(new Date());
    try {
      write(db);
    } catch {
      // Sem localStorage (modo privado restrito): segue em memória.
    }
  }
  cache = db;
  return db;
}

/** Visão única para as telas: local + remota. Mesma referência até alguma das duas mudar. */
function read(): Db {
  if (merged) return merged;
  const local = readLocal();
  merged = {
    ...local,
    authResolved: remote.authResolved,
    session: remote.account ? { accountId: remote.account.id } : local.session,
    accounts: remote.account ? [...local.accounts, remote.account] : local.accounts,
    stores: [...local.stores, ...remote.stores],
    categories: [...local.categories, ...remote.categories],
    products: [...local.products, ...remote.products],
    orders: [...local.orders, ...remote.orders],
    tabs: [...(local.tabs ?? []), ...remote.tabs],
    cashSessions: [...(local.cashSessions ?? []), ...remote.cashSessions],
    payments: [...(local.payments ?? []), ...remote.payments],
    cashMovements: [...(local.cashMovements ?? []), ...remote.cashMovements],
  };
  return merged;
}

function emit() {
  for (const l of listeners) l();
}

function onStorage(event: StorageEvent) {
  if (event.key === KEY || event.key === null) {
    cache = null;
    merged = null;
    emit();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

/** Visão mesclada (local + Supabase). */
export function getDb(): Db {
  return read();
}

/** Só o documento local (demonstração). */
export function getLocalDb(): Db {
  return readLocal();
}

/** Aplica uma mudança numa cópia do documento LOCAL e só publica se conseguir salvar. */
export function mutate<T>(fn: (db: Db) => T): T {
  const next = structuredClone(readLocal());
  const result = fn(next);
  write(next);
  cache = next;
  merged = null;
  emit();
  return result;
}

export function getRemote(): RemoteState {
  return remote;
}

/** Troca a camada remota (sempre por um objeto novo) e avisa as telas. */
export function setRemote(change: (r: RemoteState) => RemoteState) {
  remote = change(remote);
  merged = null;
  emit();
}

/** null no servidor e no primeiro render; o documento depois da hidratação. */
export function useDb(): Db | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/** Recria os dados de demonstração mantendo as contas criadas e a sessão atual. */
export function resetDemoData() {
  const current = readLocal();
  const fresh = buildDemoDb(new Date());
  const ownStores = current.stores.filter((s) => s.id !== fresh.stores[0].id);
  const ownIds = new Set(ownStores.map((s) => s.id));
  const next: Db = {
    ...fresh,
    session: current.session,
    accounts: [...fresh.accounts, ...current.accounts.filter((a) => a.id !== fresh.accounts[0].id)],
    stores: [...fresh.stores, ...ownStores],
    categories: [...fresh.categories, ...current.categories.filter((c) => ownIds.has(c.storeId))],
    products: [...fresh.products, ...current.products.filter((p) => ownIds.has(p.storeId))],
    orders: [...fresh.orders, ...current.orders.filter((o) => ownIds.has(o.storeId))],
    tabs: [...(fresh.tabs ?? []), ...(current.tabs ?? []).filter((t) => ownIds.has(t.storeId))],
    cashSessions: (current.cashSessions ?? []).filter((s) => ownIds.has(s.storeId)),
    payments: (current.payments ?? []).filter((p) => ownIds.has(p.storeId)),
    cashMovements: (current.cashMovements ?? []).filter((m) => ownIds.has(m.storeId)),
  };
  write(next);
  cache = next;
  merged = null;
  emit();
}

/** Só para testes: esquece a cópia em memória para reler o localStorage. */
export function resetCacheForTests() {
  cache = null;
  merged = null;
  remote = emptyRemote(true);
}
