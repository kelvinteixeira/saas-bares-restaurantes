import type { CashbackEntry, Db, Order, Store } from "@/lib/types";
import { onlyDigits } from "@/lib/format";
import { newId } from "@/lib/ids";

// Regras do cashback. O banco (SQL 007) aplica as mesmas: ganha ao concluir (sobre os itens pagos,
// sem a entrega), usa no checkout, devolve ao cancelar; o que vence primeiro é usado primeiro.

export const DEFAULT_CASHBACK = { enabled: false, rate: 5, validDays: 60 } as const;

export function cashbackOf(store: Pick<Store, "cashback">): { enabled: boolean; rate: number; validDays: number } {
  return store.cashback ?? DEFAULT_CASHBACK;
}

export const validPhone = (phone: string) => {
  const d = onlyDigits(phone);
  return d.length >= 10 && d.length <= 11 ? d : null;
};

/** Saldo do WhatsApp na loja: cada uso consome o ganho mais antigo que ainda valia; vencido sai. */
export function balanceOf(entries: CashbackEntry[], storeId: string, phone: string, at = new Date()): number {
  // Todos os lançamentos contam: `at` só decide o que já venceu. (O relógio da tela anda de 20 em 20 s;
  // filtrar por data de criação escondia um ganho que acabou de entrar.)
  const list = entries
    .filter((e) => e.storeId === storeId && e.phone === phone)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.kind.localeCompare(b.kind));
  const buckets: { amount: number; expires: number }[] = [];
  for (const e of list) {
    if (e.kind === "earn") {
      buckets.push({ amount: e.amount, expires: new Date(e.expiresAt!).getTime() });
      continue;
    }
    let need = e.amount;
    const when = new Date(e.createdAt).getTime();
    for (const b of buckets) {
      if (need === 0) break;
      if (b.expires > when && b.amount > 0) {
        const take = Math.min(b.amount, need);
        b.amount -= take;
        need -= take;
      }
    }
  }
  return buckets.filter((b) => b.expires > at.getTime()).reduce((s, b) => s + b.amount, 0);
}

/** Quanto o pedido rende de cashback ao ser concluído. */
export function earnAmount(order: Pick<Order, "subtotal" | "discount" | "cashbackUsed">, store: Pick<Store, "cashback">): number {
  const cb = cashbackOf(store);
  if (!cb.enabled) return 0;
  const base = Math.max(order.subtotal - (order.discount ?? 0) - (order.cashbackUsed ?? 0), 0);
  return Math.round((base * Math.min(Math.max(cb.rate, 0), 30)) / 100);
}

/**
 * Loja local: o mesmo que o trigger do banco. Ao concluir, ganha; ao cancelar, devolve o usado.
 * Muda `db` no lugar (chamado dentro de mutate).
 */
export function applyCashbackOnStatus(db: Db, order: Order, status: Order["status"], now = new Date()) {
  db.cashbackEntries ??= [];
  if (status === "cancelado") {
    db.cashbackEntries = db.cashbackEntries.filter((e) => !(e.orderId === order.id && e.kind === "spend"));
    return;
  }
  if (status !== "concluido") return;
  const phone = validPhone(order.customer.phone);
  const store = db.stores.find((s) => s.id === order.storeId);
  if (!phone || !store) return;
  if (db.cashbackEntries.some((e) => e.orderId === order.id && e.kind === "earn")) return;
  const amount = earnAmount(order, store);
  if (amount <= 0) return;
  const days = Math.min(Math.max(cashbackOf(store).validDays, 7), 365);
  db.cashbackEntries.push({
    id: newId(),
    storeId: store.id,
    phone,
    orderId: order.id,
    kind: "earn",
    amount,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
  });
}

export interface CashbackCustomer {
  phone: string;
  name: string;
  balance: number;
  earned: number;
  spent: number;
  lastAt: string;
}

/** Clientes com cashback na loja, do maior saldo para o menor. */
export function cashbackCustomers(entries: CashbackEntry[], orders: Order[], storeId: string, now = new Date()): CashbackCustomer[] {
  const mine = entries.filter((e) => e.storeId === storeId);
  const phones = [...new Set(mine.map((e) => e.phone))];
  return phones
    .map((phone) => {
      const list = mine.filter((e) => e.phone === phone);
      const last = orders
        .filter((o) => o.storeId === storeId && onlyDigits(o.customer.phone) === phone)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      return {
        phone,
        name: last?.customer.name ?? "",
        balance: balanceOf(mine, storeId, phone, now),
        earned: list.filter((e) => e.kind === "earn").reduce((s, e) => s + e.amount, 0),
        spent: list.filter((e) => e.kind === "spend").reduce((s, e) => s + e.amount, 0),
        lastAt: list.map((e) => e.createdAt).sort().at(-1)!,
      };
    })
    .sort((a, b) => b.balance - a.balance || b.lastAt.localeCompare(a.lastAt));
}
