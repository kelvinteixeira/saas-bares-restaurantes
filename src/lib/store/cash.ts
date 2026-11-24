"use client";

// Ações do caixa. Na loja do Supabase quem decide é o banco (funções do SQL 005: open_cash,
// cash_movement, close_cash, set_tab_service_fee, register_payment); na loja local, as mesmas regras.

import type { CashMovement, CashSession, Db, Payment, PaymentKind } from "@/lib/types";
import { applyStatus } from "@/lib/domain/orders";
import { cashSplit, openSession, orderDue, sessionSummary, tabDue } from "@/lib/domain/cash";
import { tabTotals } from "@/lib/domain/tabs";
import { formatMoney } from "@/lib/format";
import { newId } from "@/lib/ids";
import { getDb, mutate } from "@/lib/store/db";
import {
  friendly,
  isRemoteStore,
  remoteUpsertCashMovement,
  remoteUpsertCashSession,
  remoteUpsertOrders,
  remoteUpsertPayment,
  remoteUpsertTab,
} from "@/lib/store/remote";
import {
  rowToCashMovement,
  rowToCashSession,
  rowToOrder,
  rowToPayment,
  rowToTab,
  type CashMovementRow,
  type CashSessionRow,
  type OrderRow,
  type PaymentRow,
  type TabRow,
} from "@/lib/store/mappers";
import { getSupabase } from "@/lib/supabase/client";

export class CashError extends Error {}

function remoteError(error: { code?: string; message?: string } | null, fallback: string): CashError {
  if (error?.code === "PGRST202" || error?.code === "PGRST205" || error?.code === "42883") {
    return new CashError("O caixa ainda não está ligado no banco. Rode o arquivo supabase/migrations/005_caixa.sql no Supabase.");
  }
  if (error?.code === "P0001" && error.message) return new CashError(error.message);
  return new CashError(friendly(error, fallback).message);
}

function localOpen(db: Db, storeId: string): CashSession {
  const s = openSession(db.cashSessions ?? [], storeId);
  if (!s) throw new CashError("Abra o caixa antes de receber.");
  return s;
}

export async function openCash(storeId: string, openingAmount: number): Promise<CashSession> {
  if (!Number.isInteger(openingAmount) || openingAmount < 0) throw new CashError("Informe o fundo de troco (pode ser zero).");
  if (isRemoteStore(storeId)) {
    const { data, error } = await getSupabase().rpc("open_cash", { p_store: storeId, p_opening: openingAmount });
    if (error || !data) throw remoteError(error, "Não foi possível abrir o caixa.");
    const session = rowToCashSession(data as CashSessionRow);
    remoteUpsertCashSession(session);
    return session;
  }
  return mutate((db) => {
    db.cashSessions ??= [];
    if (openSession(db.cashSessions, storeId)) throw new CashError("O caixa já está aberto.");
    const session: CashSession = {
      id: newId(),
      storeId,
      status: "open",
      openedBy: db.session?.accountId,
      openedAt: new Date().toISOString(),
      openingAmount,
    };
    db.cashSessions.push(session);
    return session;
  });
}

/** Sangria (withdrawal) ou suprimento (deposit). */
export async function cashMovement(storeId: string, kind: CashMovement["kind"], amount: number, reason: string): Promise<void> {
  if (!Number.isInteger(amount) || amount <= 0) throw new CashError("Informe o valor.");
  if (!reason.trim()) throw new CashError("Diga o motivo.");
  if (isRemoteStore(storeId)) {
    const { data, error } = await getSupabase().rpc("cash_movement", { p_store: storeId, p_kind: kind, p_amount: amount, p_reason: reason });
    if (error || !data) throw remoteError(error, "Não foi possível registrar.");
    remoteUpsertCashMovement(rowToCashMovement(data as CashMovementRow));
    return;
  }
  mutate((db) => {
    const s = openSession(db.cashSessions ?? [], storeId);
    if (!s) throw new CashError("Abra o caixa primeiro.");
    const { expectedCash } = sessionSummary(s, db.payments ?? [], db.cashMovements ?? []);
    if (kind === "withdrawal" && amount > expectedCash) {
      throw new CashError(`Não há ${formatMoney(amount)} em dinheiro no caixa (tem ${formatMoney(expectedCash)}).`);
    }
    db.cashMovements ??= [];
    db.cashMovements.push({
      id: newId(),
      storeId,
      cashSessionId: s.id,
      kind,
      amount,
      reason: reason.trim().slice(0, 140),
      createdBy: db.session?.accountId,
      createdAt: new Date().toISOString(),
    });
  });
}

export async function closeCash(storeId: string, counted: number, notes?: string): Promise<CashSession> {
  if (!Number.isInteger(counted) || counted < 0) throw new CashError("Informe quanto há em dinheiro na gaveta.");
  if (isRemoteStore(storeId)) {
    const { data, error } = await getSupabase().rpc("close_cash", { p_store: storeId, p_counted: counted, p_notes: notes ?? null });
    if (error || !data) throw remoteError(error, "Não foi possível fechar o caixa.");
    const session = rowToCashSession(data as CashSessionRow);
    remoteUpsertCashSession(session);
    return session;
  }
  return mutate((db) => {
    const s = openSession(db.cashSessions ?? [], storeId);
    if (!s) throw new CashError("O caixa já está fechado.");
    s.expectedAmount = sessionSummary(s, db.payments ?? [], db.cashMovements ?? []).expectedCash;
    s.countedAmount = counted;
    s.status = "closed";
    s.closedAt = new Date().toISOString();
    s.closedBy = db.session?.accountId;
    s.notes = notes?.trim().slice(0, 300) || undefined;
    return { ...s };
  });
}

/** Tira (ou devolve) a taxa de serviço da conta da mesa. */
export async function setTabServiceFee(tabId: string, removed: boolean): Promise<void> {
  const tab = (getDb().tabs ?? []).find((t) => t.id === tabId);
  if (tab && isRemoteStore(tab.storeId)) {
    const { data, error } = await getSupabase().rpc("set_tab_service_fee", { p_tab: tabId, p_removed: removed });
    if (error || !data) throw remoteError(error, "Não foi possível mudar a taxa.");
    remoteUpsertTab(rowToTab(data as TabRow));
    return;
  }
  mutate((db) => {
    const t = (db.tabs ?? []).find((x) => x.id === tabId);
    if (!t) throw new CashError("Comanda não encontrada.");
    if (t.status === "closed") throw new CashError("Esta comanda já foi fechada.");
    const paid = (db.payments ?? []).filter((p) => p.tabId === tabId).reduce((s, p) => s + p.amount, 0);
    const total = tabTotals({ ...t, serviceFeeRemoved: removed }, db.orders).total;
    if (paid > total) throw new CashError(`Já foi recebido ${formatMoney(paid)} e a conta sem a taxa fica em ${formatMoney(total)}.`);
    t.serviceFeeRemoved = removed;
  });
}

export interface PaymentInput {
  tabId?: string;
  orderId?: string;
  method: PaymentKind;
  /** Pix e cartão: quanto abater. */
  amount?: number;
  /** Dinheiro: quanto o cliente entregou. */
  received?: number;
}

export interface PaymentResult {
  payment: Payment;
  due: number;
  tabClosed: boolean;
}

/** Recebe um pagamento. Quando a conta da mesa zera, a mesa fecha sozinha. */
export async function registerPayment(input: PaymentInput): Promise<PaymentResult> {
  const db = getDb();
  const storeId = input.tabId
    ? (db.tabs ?? []).find((t) => t.id === input.tabId)?.storeId
    : db.orders.find((o) => o.id === input.orderId)?.storeId;
  if (!storeId) throw new CashError(input.tabId ? "Comanda não encontrada." : "Pedido não encontrado.");

  if (isRemoteStore(storeId)) {
    const { data, error } = await getSupabase().rpc("register_payment", { payload: input });
    if (error || !data) throw remoteError(error, "Não foi possível receber.");
    const result = data as { payment: PaymentRow; due: number; tabClosed: boolean };
    const payment = rowToPayment(result.payment);
    remoteUpsertPayment(payment);
    if (result.tabClosed && input.tabId) {
      // A mesa fechou: busca a comanda e os pedidos dela como ficaram.
      const sb = getSupabase();
      const [tabRes, ordersRes] = await Promise.all([
        sb.from("tabs").select("*").eq("id", input.tabId).single<TabRow>(),
        sb.from("orders").select("*").eq("tab_id", input.tabId),
      ]);
      if (tabRes.data) remoteUpsertTab(rowToTab(tabRes.data));
      if (ordersRes.data) remoteUpsertOrders((ordersRes.data as OrderRow[]).map(rowToOrder));
    }
    return { payment, due: result.due, tabClosed: result.tabClosed };
  }

  return mutate((local) => {
    const session = localOpen(local, storeId);
    const tab = input.tabId ? (local.tabs ?? []).find((t) => t.id === input.tabId) : undefined;
    const order = input.orderId ? local.orders.find((o) => o.id === input.orderId) : undefined;
    if (tab?.status === "closed") throw new CashError("Esta comanda já foi fechada.");
    if (order?.tabId) throw new CashError(`Este pedido é da mesa ${order.tableNumber}: receba pela conta da mesa.`);
    local.payments ??= [];
    const due = tab ? tabDue(tab, local.orders, local.payments) : orderDue(order!, local.payments);
    if (due <= 0) throw new CashError("Esta conta já está paga.");

    let amount: number;
    let change = 0;
    if (input.method === "cash") {
      if (!input.received || input.received <= 0) throw new CashError("Informe quanto o cliente entregou.");
      ({ amount, change } = cashSplit(due, input.received));
    } else {
      amount = input.amount ?? 0;
      if (!Number.isInteger(amount) || amount <= 0) throw new CashError("Informe o valor.");
      if (amount > due) throw new CashError(`O valor passa do que falta (${formatMoney(due)}).`);
    }

    const payment: Payment = {
      id: newId(),
      storeId,
      cashSessionId: session.id,
      tabId: tab?.id,
      orderId: order?.id,
      method: input.method,
      amount,
      changeGiven: change,
      createdBy: local.session?.accountId,
      createdAt: new Date().toISOString(),
    };
    local.payments.push(payment);

    const left = due - amount;
    let tabClosed = false;
    if (tab && left === 0) {
      finishLocalTab(local, tab.id);
      tabClosed = true;
    }
    return { payment, due: left, tabClosed };
  });
}

/** Fecha a comanda local: pedidos abertos viram servidos e a mesa fica livre. */
export function finishLocalTab(db: Db, tabId: string) {
  const tab = (db.tabs ?? []).find((t) => t.id === tabId);
  if (!tab) return;
  const now = new Date();
  db.orders = db.orders.map((o) =>
    o.tabId === tabId && o.status !== "concluido" && o.status !== "cancelado" ? applyStatus(o, "concluido", now) : o,
  );
  tab.status = "closed";
  tab.closedAt = now.toISOString();
  tab.closedBy = db.session?.accountId;
}
