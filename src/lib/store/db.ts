"use client";

// Banco simulado da fase 1: um único documento JSON no localStorage do navegador.
// Abas diferentes do mesmo navegador recebem as mudanças pelo evento "storage",
// então um pedido feito no cardápio aparece no painel aberto em outra aba.
// Na fase 2 este módulo é trocado por chamadas ao Supabase, mantendo as ações de actions.ts.

import { useSyncExternalStore } from "react";
import type { Db } from "@/lib/types";
import { buildDemoDb } from "@/lib/seed";

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

function read(): Db {
  if (cache) return cache;
  let db: Db | null = null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) db = JSON.parse(raw) as Db;
  } catch {
    db = null;
  }
  if (db) migrateDefaultColors(db);
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

function emit() {
  for (const l of listeners) l();
}

function onStorage(event: StorageEvent) {
  if (event.key === KEY || event.key === null) {
    cache = null;
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

export function getDb(): Db {
  return read();
}

/** Aplica uma mudança numa cópia e só publica se conseguir salvar. */
export function mutate<T>(fn: (db: Db) => T): T {
  const next = structuredClone(read());
  const result = fn(next);
  write(next);
  cache = next;
  emit();
  return result;
}

/** null no servidor e no primeiro render; o documento depois da hidratação. */
export function useDb(): Db | null {
  return useSyncExternalStore(subscribe, read, () => null);
}

/** Recria os dados de demonstração mantendo as contas criadas e a sessão atual. */
export function resetDemoData() {
  const current = read();
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
  };
  write(next);
  cache = next;
  emit();
}

/** Só para testes: esquece a cópia em memória para reler o localStorage. */
export function resetCacheForTests() {
  cache = null;
}
