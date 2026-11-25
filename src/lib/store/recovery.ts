"use client";

// Recuperador de vendas. O cardápio guarda a sacola de quem digitou o WhatsApp no fechamento
// (loja do Supabase: função save_cart do SQL 011, sem login); dono e gerente chamam ou descartam.

import type { AbandonedCart, OrderMode, Product } from "@/lib/types";
import { unitPrice, type CartLine } from "@/lib/domain/pricing";
import { validPhone } from "@/lib/domain/cashback";
import { newId } from "@/lib/ids";
import { getDb, mutate } from "@/lib/store/db";
import { friendly, isRemoteStore, remoteUpsertCart } from "@/lib/store/remote";
import { rowToCart, type CartRow } from "@/lib/store/mappers";
import { getSupabase } from "@/lib/supabase/client";

export class RecoveryError extends Error {}

export interface CartSnapshot {
  storeId: string;
  phone: string;
  name: string;
  mode: OrderMode | null;
  lines: CartLine[];
  products: Product[];
}

/** Guarda a sacola (nunca dá erro: é só um lembrete para a loja). Mesa não guarda. */
export async function saveAbandonedCart(snap: CartSnapshot): Promise<void> {
  const phone = validPhone(snap.phone);
  if (!phone || snap.mode === "table" || !snap.lines.length) return;
  const items = snap.lines.flatMap((l) => {
    const p = snap.products.find((x) => x.id === l.productId);
    return p ? [{ productId: p.id, name: p.name, quantity: Math.min(Math.max(l.quantity, 1), 99), price: Math.max(unitPrice(p, l.selections), p.price) }] : [];
  });
  if (!items.length) return;
  const mode = snap.mode === "delivery" || snap.mode === "pickup" ? snap.mode : undefined;
  try {
    if (isRemoteStore(snap.storeId)) {
      await getSupabase().rpc("save_cart", {
        p_store: snap.storeId,
        p_phone: phone,
        p_name: snap.name.trim().slice(0, 60),
        p_items: items.map(({ productId, quantity, price }) => ({ productId, quantity, price })),
        p_mode: mode ?? null,
      });
      return;
    }
    const now = new Date().toISOString();
    mutate((db) => {
      db.carts ??= [];
      const subtotal = items.reduce((s, i) => s + i.quantity * i.price, 0);
      const open = db.carts.find((c) => c.storeId === snap.storeId && c.phone === phone && (c.status === "open" || c.status === "contacted"));
      if (open) Object.assign(open, { name: snap.name.trim().slice(0, 60), items, subtotal, mode, updatedAt: now });
      else db.carts.push({ id: newId(), storeId: snap.storeId, phone, name: snap.name.trim().slice(0, 60), items, subtotal, mode, status: "open", createdAt: now, updatedAt: now });
      // Mesma limpeza do banco: some depois de 30 dias.
      db.carts = db.carts.filter((c) => Date.now() - new Date(c.updatedAt).getTime() < 30 * 86400000);
    });
  } catch {
    // sem lembrete, sem problema
  }
}

async function setStatus(cart: AbandonedCart, change: Pick<AbandonedCart, "status"> & { contactedAt?: string }): Promise<void> {
  if (isRemoteStore(cart.storeId)) {
    const { data, error } = await getSupabase()
      .from("abandoned_carts")
      .update({ status: change.status, ...(change.contactedAt ? { contacted_at: change.contactedAt } : {}) })
      .eq("id", cart.id)
      .select()
      .maybeSingle<CartRow>();
    if (error?.code === "PGRST205" || error?.code === "42P01") {
      throw new RecoveryError("O recuperador ainda não está ligado no banco. Rode o arquivo supabase/migrations/011_recuperador.sql no Supabase.");
    }
    if (error || !data) throw new RecoveryError(friendly(error, "Não foi possível atualizar a sacola.").message);
    remoteUpsertCart(rowToCart(data));
    return;
  }
  mutate((db) => {
    const c = (db.carts ?? []).find((x) => x.id === cart.id);
    if (!c) throw new RecoveryError("Sacola não encontrada.");
    c.status = change.status;
    if (change.contactedAt) c.contactedAt = change.contactedAt;
  });
}

/** A loja abriu o WhatsApp do cliente: conta como chamada (para medir a venda recuperada). */
export function markContacted(cart: AbandonedCart): Promise<void> {
  if (cart.status !== "open") return Promise.resolve();
  return setStatus(cart, { status: "contacted", contactedAt: new Date().toISOString() });
}

export function dismissCart(cart: AbandonedCart): Promise<void> {
  return setStatus(cart, { status: "dismissed" });
}

/** Só para conferir nos testes. */
export const cartsOf = (storeId: string) => (getDb().carts ?? []).filter((c) => c.storeId === storeId);
