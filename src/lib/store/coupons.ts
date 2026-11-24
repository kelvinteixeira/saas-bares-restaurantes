"use client";

// Cupons: o dono e o gerente cadastram; o cliente confere no checkout. Na loja do Supabase quem
// confere é o banco (SQL 006: check_coupon e place_order); na loja local, as mesmas regras.

import type { Coupon, OrderMode } from "@/lib/types";
import { CODE_PATTERN, CouponError, evaluateCoupon, normalizeCode } from "@/lib/domain/coupons";
import { newId } from "@/lib/ids";
import { getDb, mutate } from "@/lib/store/db";
import { friendly, isRemoteStore, remoteRemoveCoupon, remoteUpsertCoupon } from "@/lib/store/remote";
import { couponToRow, rowToCoupon, type CouponRow } from "@/lib/store/mappers";
import { getSupabase } from "@/lib/supabase/client";

export { CouponError };

function remoteError(error: { code?: string; message?: string } | null, fallback: string): CouponError {
  if (error?.code === "PGRST202" || error?.code === "PGRST205" || error?.code === "42883" || error?.code === "42P01") {
    return new CouponError("Os cupons ainda não estão ligados no banco. Rode o arquivo supabase/migrations/006_cupons.sql no Supabase.");
  }
  if (error?.code === "23505") return new CouponError("Já existe um cupom com esse código.");
  if (error?.code === "P0001" && error.message) return new CouponError(error.message);
  return new CouponError(friendly(error, fallback).message);
}

export function newCoupon(storeId: string): Coupon {
  return { id: newId(), storeId, code: "", kind: "percent", value: 10, minOrder: 0, oncePerCustomer: false, active: true, createdAt: new Date().toISOString() };
}

/** Confere o que o banco também confere, para dar a mensagem certa antes de salvar. */
function validate(c: Coupon) {
  if (!CODE_PATTERN.test(c.code)) throw new CouponError("O código precisa ter de 3 a 20 letras ou números, sem espaço.");
  if (c.kind === "percent" && (c.value < 1 || c.value > 100)) throw new CouponError("A porcentagem vai de 1 a 100.");
  if (c.kind === "fixed" && c.value <= 0) throw new CouponError("Informe o valor do desconto.");
  if (c.maxUses !== undefined && c.maxUses < 1) throw new CouponError("O limite de usos precisa ser 1 ou mais.");
  if (c.startsAt && c.endsAt && new Date(c.endsAt) <= new Date(c.startsAt)) throw new CouponError("O fim precisa ser depois do início.");
}

export async function saveCoupon(input: Coupon): Promise<Coupon> {
  const coupon = { ...input, code: normalizeCode(input.code), value: input.kind === "free_delivery" ? 0 : input.value };
  validate(coupon);
  if (isRemoteStore(coupon.storeId)) {
    const { data, error } = await getSupabase().from("coupons").upsert(couponToRow(coupon)).select().single<CouponRow>();
    if (error || !data) throw remoteError(error, "Não foi possível salvar o cupom.");
    const saved = rowToCoupon(data);
    remoteUpsertCoupon(saved);
    return saved;
  }
  return mutate((db) => {
    db.coupons ??= [];
    if (db.coupons.some((c) => c.storeId === coupon.storeId && c.code === coupon.code && c.id !== coupon.id)) {
      throw new CouponError("Já existe um cupom com esse código.");
    }
    const i = db.coupons.findIndex((c) => c.id === coupon.id);
    if (i >= 0) db.coupons[i] = coupon;
    else db.coupons.unshift(coupon);
    return coupon;
  });
}

export async function deleteCoupon(coupon: Coupon): Promise<void> {
  if (isRemoteStore(coupon.storeId)) {
    const { error } = await getSupabase().from("coupons").delete().eq("id", coupon.id);
    if (error) throw remoteError(error, "Não foi possível apagar o cupom.");
    remoteRemoveCoupon(coupon.id);
    return;
  }
  mutate((db) => {
    db.coupons = (db.coupons ?? []).filter((c) => c.id !== coupon.id);
  });
}

/** Prévia no checkout: devolve o código normalizado e o desconto, ou lança CouponError. */
export async function checkCoupon(
  storeId: string,
  code: string,
  ctx: { subtotal: number; fee: number; mode: OrderMode; phone: string },
): Promise<{ code: string; discount: number }> {
  const clean = normalizeCode(code);
  if (!clean) throw new CouponError("Digite o código do cupom.");
  if (isRemoteStore(storeId)) {
    const { data, error } = await getSupabase().rpc("check_coupon", {
      p_store: storeId,
      p_code: clean,
      p_subtotal: ctx.subtotal,
      p_fee: ctx.fee,
      p_mode: ctx.mode,
      p_phone: ctx.phone,
    });
    if (error || !data) throw remoteError(error, "Não foi possível conferir o cupom.");
    const result = data as { code: string; discount: number };
    return { code: result.code, discount: result.discount };
  }
  const db = getDb();
  const coupon = (db.coupons ?? []).find((c) => c.storeId === storeId && c.code === clean);
  const discount = evaluateCoupon(coupon, { ...ctx, now: new Date(), orders: db.orders });
  return { code: clean, discount };
}
