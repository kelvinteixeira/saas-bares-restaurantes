"use client";

// Pedido lançado pelo caixa no PDV (balcão, telefone ou mesa). Na loja do Supabase quem confere é a
// função pdv_order (SQL 004); na loja local, as mesmas regras aqui.

import type { Order, OrderMode, PaymentMethod } from "@/lib/types";
import type { CartLine } from "@/lib/domain/pricing";
import { attachToTab } from "@/lib/domain/tabs";
import { onlyDigits } from "@/lib/format";
import { newId } from "@/lib/ids";
import { getDb, mutate } from "@/lib/store/db";
import { priceLocalLines } from "@/lib/store/actions";
import { friendly, isRemoteStore, remoteUpsertOrder, remoteUpsertTab } from "@/lib/store/remote";
import { rowToOrder, type OrderRow } from "@/lib/store/mappers";
import { getSupabase } from "@/lib/supabase/client";

export class PdvError extends Error {}

export interface PdvInput {
  storeId: string;
  mode: OrderMode;
  lines: CartLine[];
  customer: { name: string; phone: string };
  delivery?: { regionId: string; street: string; number: string; complement?: string; reference?: string };
  tableNumber?: number;
  payment: { method: PaymentMethod; changeFor?: number };
  notes?: string;
}

function remoteError(error: { code?: string; message?: string } | null): PdvError {
  if (error?.code === "PGRST202" || error?.code === "42883") {
    return new PdvError("O PDV ainda não está ligado no banco. Rode o arquivo supabase/migrations/004_pdv.sql no Supabase.");
  }
  if (error?.code === "P0001" && error.message) return new PdvError(error.message);
  return new PdvError(friendly(error, "Não foi possível lançar o pedido.").message);
}

export async function pdvOrder(input: PdvInput): Promise<Order> {
  if (!input.lines.length) throw new PdvError("Escolha pelo menos um item.");

  if (isRemoteStore(input.storeId)) {
    const payload = {
      ...input,
      lines: input.lines.map(({ productId, selections, quantity, notes }) => ({ productId, selections, quantity, notes })),
    };
    const { data, error } = await getSupabase().rpc("pdv_order", { payload });
    if (error || !data) throw remoteError(error);
    const order = rowToOrder(data as OrderRow);
    remoteUpsertOrder(order);
    // O trigger do banco pode ter reaberto a comanda da mesa; o tempo real confirma em seguida.
    const tab = order.tabId ? (getDb().tabs ?? []).find((t) => t.id === order.tabId) : undefined;
    if (tab?.status === "bill_requested") remoteUpsertTab({ ...tab, status: "open" });
    return order;
  }

  return mutate((db) => {
    const store = db.stores.find((s) => s.id === input.storeId);
    if (!store) throw new PdvError("Loja não encontrada.");
    let name = input.customer.name.trim().slice(0, 80);
    const phone = onlyDigits(input.customer.phone);
    if (phone && (phone.length < 10 || phone.length > 11)) throw new PdvError("Telefone com DDD, ou deixe em branco.");

    const { items, subtotal } = priceLocalLines(db, store, input.lines);
    let fee = 0;
    let eta = 25;
    let delivery: Order["delivery"];
    if (input.mode === "delivery") {
      if (!phone) throw new PdvError("Na entrega, informe o telefone do cliente.");
      const region = store.delivery.regions.find((r) => r.id === input.delivery?.regionId && r.active);
      if (!region || !input.delivery) throw new PdvError("Escolha um bairro atendido.");
      if (!input.delivery.street.trim() || !input.delivery.number.trim()) throw new PdvError("Informe rua e número.");
      if (!name) throw new PdvError("Na entrega, informe o nome do cliente.");
      fee = region.fee;
      eta = store.delivery.etaMax;
      delivery = {
        regionId: region.id,
        regionName: region.name,
        street: input.delivery.street.trim(),
        number: input.delivery.number.trim(),
        complement: input.delivery.complement?.trim() || undefined,
        reference: input.delivery.reference?.trim() || undefined,
      };
    } else if (input.mode === "pickup") {
      eta = store.pickup.etaMax;
      if (!name) name = "Balcão";
    } else {
      const t = input.tableNumber;
      if (!t || !Number.isInteger(t) || t < 1 || t > store.table.count) throw new PdvError(`Mesa ${t ?? ""} não existe.`);
      name = `Mesa ${t}`;
    }

    const total = subtotal + fee;
    let payment: Order["payment"];
    if (input.mode === "table") payment = { method: "tab" };
    else {
      if (!["pix", "card", "cash"].includes(input.payment.method)) throw new PdvError("Escolha a forma de pagamento.");
      if (input.payment.method === "cash" && input.payment.changeFor !== undefined && input.payment.changeFor < total) {
        throw new PdvError("O valor para troco precisa ser maior ou igual ao total.");
      }
      payment = input.payment.method === "cash" && input.payment.changeFor !== undefined ? input.payment : { method: input.payment.method };
    }

    const now = new Date();
    const order: Order = {
      id: newId(),
      storeId: store.id,
      number: store.nextOrderNumber++,
      createdAt: now.toISOString(),
      promisedAt: new Date(now.getTime() + eta * 60_000).toISOString(),
      status: "novo",
      history: [{ status: "novo", at: now.toISOString() }],
      mode: input.mode,
      customer: { name, phone },
      delivery,
      tableNumber: input.mode === "table" ? input.tableNumber : undefined,
      items,
      subtotal,
      deliveryFee: fee,
      total,
      payment,
      notes: input.notes?.trim().slice(0, 200) || undefined,
      source: "pdv",
      createdBy: db.session?.accountId,
    };
    db.tabs ??= [];
    // Mesma regra do trigger do banco: mesa entra na comanda aberta ou abre uma.
    attachToTab(db.tabs, order, store, newId, db.session?.accountId);
    db.orders.push(order);
    return order;
  });
}
