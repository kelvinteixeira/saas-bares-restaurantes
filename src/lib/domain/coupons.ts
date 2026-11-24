import type { Coupon, Order, OrderMode } from "@/lib/types";
import { formatMoney, onlyDigits } from "@/lib/format";

// Regras do cupom. O banco (SQL 006, coupon_discount) aplica as mesmas e com as mesmas mensagens.

export class CouponError extends Error {}

/** Código como fica guardado: maiúsculo, sem espaços. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export const CODE_PATTERN = /^[A-Z0-9]{3,20}$/;

export function couponLabel(c: Pick<Coupon, "kind" | "value">): string {
  if (c.kind === "percent") return `${c.value}% de desconto`;
  if (c.kind === "fixed") return `${formatMoney(c.value)} de desconto`;
  return "Entrega grátis";
}

/** Usos que contam: pedidos não cancelados com o cupom. */
export function couponUses(coupon: Pick<Coupon, "id">, orders: Order[]): Order[] {
  return orders.filter((o) => o.couponId === coupon.id && o.status !== "cancelado");
}

export interface CouponContext {
  subtotal: number;
  fee: number;
  mode: OrderMode;
  phone: string;
  now: Date;
  orders: Order[];
}

/** Confere o cupom e devolve o desconto. Lança CouponError com a mensagem para o cliente. */
export function evaluateCoupon(coupon: Coupon | undefined, ctx: CouponContext): number {
  if (!coupon || !coupon.active) throw new CouponError("Cupom inválido.");
  if (coupon.startsAt && ctx.now < new Date(coupon.startsAt)) throw new CouponError("Este cupom ainda não começou.");
  if (coupon.endsAt && ctx.now >= new Date(coupon.endsAt)) throw new CouponError("Este cupom venceu.");
  if (ctx.subtotal < coupon.minOrder) throw new CouponError(`Este cupom vale para pedidos a partir de ${formatMoney(coupon.minOrder)}.`);
  const uses = couponUses(coupon, ctx.orders);
  if (coupon.maxUses !== undefined && uses.length >= coupon.maxUses) throw new CouponError("Este cupom esgotou.");
  if (coupon.oncePerCustomer) {
    const phone = onlyDigits(ctx.phone);
    if (!phone) throw new CouponError("Informe seu WhatsApp para usar este cupom.");
    if (uses.some((o) => o.customer.phone === phone)) throw new CouponError("Você já usou este cupom.");
  }
  if (coupon.kind === "free_delivery") {
    if (ctx.mode !== "delivery") throw new CouponError("Este cupom é de entrega grátis.");
    return ctx.fee;
  }
  if (coupon.kind === "percent") return Math.round((ctx.subtotal * coupon.value) / 100);
  return Math.min(coupon.value, ctx.subtotal);
}

export type CouponStatus = "active" | "scheduled" | "expired" | "exhausted" | "off";

export function couponStatus(coupon: Coupon, orders: Order[], now: Date): CouponStatus {
  if (!coupon.active) return "off";
  if (coupon.endsAt && now >= new Date(coupon.endsAt)) return "expired";
  if (coupon.startsAt && now < new Date(coupon.startsAt)) return "scheduled";
  if (coupon.maxUses !== undefined && couponUses(coupon, orders).length >= coupon.maxUses) return "exhausted";
  return "active";
}
