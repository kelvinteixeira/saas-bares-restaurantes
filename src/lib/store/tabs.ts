"use client";

// Ações da comanda de mesa. Na loja do Supabase quem decide é o banco (funções do SQL 003:
// open_tab, add_to_tab, request_bill, transfer_tab, close_tab); na loja local, as mesmas regras aqui.

import type { Db, Order, Store, Tab } from "@/lib/types";
import type { CartLine } from "@/lib/domain/pricing";
import { applyStatus } from "@/lib/domain/orders";
import { attachToTab, openTabFor, rateForNewTab } from "@/lib/domain/tabs";
import { tabDue } from "@/lib/domain/cash";
import { applyCashbackOnStatus } from "@/lib/domain/cashback";
import { formatMoney } from "@/lib/format";
import { newId } from "@/lib/ids";
import { getDb, mutate } from "@/lib/store/db";
import { priceLocalLines } from "@/lib/store/actions";
import { friendly, isRemoteStore, remoteUpsertOrder, remoteUpsertOrders, remoteUpsertTab } from "@/lib/store/remote";
import { rowToOrder, rowToTab, type OrderRow, type TabRow } from "@/lib/store/mappers";
import { getSupabase } from "@/lib/supabase/client";

export class TabError extends Error {}

function remoteError(error: { code?: string; message?: string } | null, fallback: string): TabError {
  if (error?.code === "PGRST202" || error?.code === "PGRST205" || error?.code === "42883") {
    return new TabError("As comandas ainda não estão ligadas no banco. Rode o arquivo supabase/migrations/003_comandas.sql no Supabase.");
  }
  // Mensagens das funções do banco já vêm em português.
  if (error?.code === "P0001" && error.message) return new TabError(error.message);
  return new TabError(friendly(error, fallback).message);
}

function localStore(db: Db, storeId: string): Store {
  const store = db.stores.find((s) => s.id === storeId);
  if (!store) throw new TabError("Loja não encontrada.");
  return store;
}

function localTab(db: Db, tabId: string): Tab {
  const tab = (db.tabs ?? []).find((t) => t.id === tabId);
  if (!tab) throw new TabError("Comanda não encontrada.");
  if (tab.status === "closed") throw new TabError("Esta comanda já foi fechada.");
  return tab;
}

function checkTable(store: Store, table: number) {
  if (!Number.isInteger(table) || table < 1 || table > store.table.count) {
    throw new TabError(`Mesa ${table} não existe. Confira o número de mesas nas configurações.`);
  }
}

/** Abre a comanda da mesa; se outro garçom já abriu, devolve a mesma. */
export async function openTab(storeId: string, table: number): Promise<Tab> {
  if (isRemoteStore(storeId)) {
    const { data, error } = await getSupabase().rpc("open_tab", { p_store: storeId, p_table: table });
    if (error || !data) throw remoteError(error, "Não foi possível abrir a mesa.");
    const tab = rowToTab(data as TabRow);
    remoteUpsertTab(tab);
    return tab;
  }
  return mutate((db) => {
    const store = localStore(db, storeId);
    checkTable(store, table);
    db.tabs ??= [];
    const existing = openTabFor(db.tabs, storeId, table);
    if (existing) return existing;
    const tab: Tab = {
      id: newId(),
      storeId,
      tableNumber: table,
      status: "open",
      openedBy: db.session?.accountId,
      openedAt: new Date().toISOString(),
      serviceFeeRate: rateForNewTab(store),
      serviceFeeRemoved: false,
    };
    db.tabs.push(tab);
    return tab;
  });
}

/**
 * Lança itens na mesa (abre a comanda se a mesa estiver livre). O lançamento vira um pedido que vai
 * para a tela de preparo e para a fila do painel.
 */
export async function addToTab(storeId: string, table: number, lines: CartLine[], notes?: string): Promise<Order> {
  if (!lines.length) throw new TabError("Escolha pelo menos um item.");
  const cleanNotes = notes?.trim().slice(0, 200) || undefined;

  if (isRemoteStore(storeId)) {
    const tab = openTabFor(getDb().tabs ?? [], storeId, table) ?? (await openTab(storeId, table));
    const payload = lines.map(({ productId, selections, quantity, notes: n }) => ({ productId, selections, quantity, notes: n }));
    const { data, error } = await getSupabase().rpc("add_to_tab", { p_tab: tab.id, p_lines: payload, p_notes: cleanNotes ?? null });
    if (error || !data) throw remoteError(error, "Não foi possível lançar os itens.");
    const order = rowToOrder(data as OrderRow);
    remoteUpsertOrder(order);
    if (tab.status === "bill_requested") remoteUpsertTab({ ...tab, status: "open" });
    return order;
  }

  return mutate((db) => {
    const store = localStore(db, storeId);
    checkTable(store, table);
    db.tabs ??= [];
    const { items, subtotal } = priceLocalLines(db, store, lines);
    const now = new Date();
    const order: Order = {
      id: newId(),
      storeId,
      number: store.nextOrderNumber++,
      createdAt: now.toISOString(),
      promisedAt: new Date(now.getTime() + 25 * 60_000).toISOString(),
      status: "novo",
      history: [{ status: "novo", at: now.toISOString() }],
      mode: "table",
      customer: { name: `Mesa ${table}`, phone: "" },
      tableNumber: table,
      items,
      subtotal,
      deliveryFee: 0,
      total: subtotal,
      payment: { method: "tab" },
      notes: cleanNotes,
      source: "garcom",
      createdBy: db.session?.accountId,
    };
    attachToTab(db.tabs, order, store, newId, db.session?.accountId);
    db.orders.push(order);
    return order;
  });
}

/** Pedir a conta (ou desfazer). */
export async function requestBill(tabId: string, requested = true): Promise<void> {
  const tab = (getDb().tabs ?? []).find((t) => t.id === tabId);
  if (tab && isRemoteStore(tab.storeId)) {
    const { data, error } = await getSupabase().rpc("request_bill", { p_tab: tabId, p_requested: requested });
    if (error || !data) throw remoteError(error, "Não foi possível pedir a conta.");
    remoteUpsertTab(rowToTab(data as TabRow));
    return;
  }
  mutate((db) => {
    localTab(db, tabId).status = requested ? "bill_requested" : "open";
  });
}

async function refreshTabOrders(tabId: string) {
  const { data, error } = await getSupabase().from("orders").select("*").eq("tab_id", tabId);
  if (!error && data) remoteUpsertOrders((data as OrderRow[]).map(rowToOrder));
}

/** Leva a comanda e os pedidos dela para outra mesa, que precisa estar livre. */
export async function transferTab(tabId: string, table: number): Promise<void> {
  const tab = (getDb().tabs ?? []).find((t) => t.id === tabId);
  if (tab && isRemoteStore(tab.storeId)) {
    const { data, error } = await getSupabase().rpc("transfer_tab", { p_tab: tabId, p_table: table });
    if (error || !data) throw remoteError(error, "Não foi possível trocar de mesa.");
    remoteUpsertTab(rowToTab(data as TabRow));
    await refreshTabOrders(tabId);
    return;
  }
  mutate((db) => {
    const t = localTab(db, tabId);
    const store = localStore(db, t.storeId);
    checkTable(store, table);
    if (table === t.tableNumber) return;
    if (openTabFor(db.tabs ?? [], store.id, table)) throw new TabError(`A mesa ${table} já está ocupada.`);
    t.tableNumber = table;
    for (const o of db.orders) {
      if (o.tabId !== tabId) continue;
      o.tableNumber = table;
      if (o.source === "garcom") o.customer = { ...o.customer, name: `Mesa ${table}` };
    }
  });
}

/**
 * Fecha a mesa quando a conta está paga (ou não há nada a pagar). Com o caixa (SQL 005), quem fecha
 * normalmente é o último pagamento; isto serve para a mesa aberta sem consumo.
 */
export async function closeTab(tabId: string, removeServiceFee = false): Promise<void> {
  const tab = (getDb().tabs ?? []).find((t) => t.id === tabId);
  if (tab && isRemoteStore(tab.storeId)) {
    const { data, error } = await getSupabase().rpc("close_tab", { p_tab: tabId, p_remove_service_fee: removeServiceFee });
    if (error || !data) throw remoteError(error, "Não foi possível fechar a conta.");
    remoteUpsertTab(rowToTab(data as TabRow));
    await refreshTabOrders(tabId);
    return;
  }
  mutate((db) => {
    const t = localTab(db, tabId);
    if (removeServiceFee) t.serviceFeeRemoved = true;
    const due = tabDue(t, db.orders, db.payments ?? []);
    if (due > 0) throw new TabError(`Ainda falta receber ${formatMoney(due)}. Registre os pagamentos para fechar.`);
    const now = new Date();
    db.orders = db.orders.map((o) => {
      if (o.tabId !== tabId || o.status === "concluido" || o.status === "cancelado") return o;
      const done = applyStatus(o, "concluido", now);
      applyCashbackOnStatus(db, done, "concluido", now);
      return done;
    });
    t.status = "closed";
    t.closedAt = now.toISOString();
    t.closedBy = db.session?.accountId;
  });
}
