import type { AbandonedCart, Coupon, Order, Store } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { couponLabel } from "@/lib/domain/coupons";

// Recuperador de vendas: sacola de quem digitou o WhatsApp no fechamento e não pediu.
// O banco (SQL 011) guarda e converte; aqui ficam as regras de exibição e a mensagem.

/** Sem mexer há tanto tempo, a sacola conta como abandonada (antes disso a pessoa pode estar terminando). */
export const ABANDON_MINUTES = 10;
/** Pedido até tantos dias depois ainda converte a sacola. */
export const CONVERT_DAYS = 7;
const DAY = 86400000;

/** Sacolas para chamar: abertas ou já chamadas, paradas há 10 min, dos últimos 7 dias. Mais novas primeiro. */
export function cartsToRecover(carts: AbandonedCart[], storeId: string, now: Date): AbandonedCart[] {
  const t = now.getTime();
  return carts
    .filter((c) => c.storeId === storeId && (c.status === "open" || c.status === "contacted"))
    .filter((c) => {
      const age = t - new Date(c.updatedAt).getTime();
      return age >= ABANDON_MINUTES * 60000 && age <= CONVERT_DAYS * DAY;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface RecoveryStats {
  /** Sacolas abandonadas no período (paradas há 10 min, convertidas ou não). */
  abandoned: number;
  contacted: number;
  /** Chamadas pela loja e que viraram pedido. */
  recovered: number;
  /** Total dos pedidos recuperados (não cancelados). */
  revenue: number;
}

export function recoveryStats(carts: AbandonedCart[], orders: Order[], storeId: string, from: Date, to: Date): RecoveryStats {
  const mine = carts.filter((c) => {
    const t = new Date(c.createdAt).getTime();
    return c.storeId === storeId && t >= from.getTime() && t < to.getTime();
  });
  // Pedido cancelado não é venda recuperada.
  const recovered = mine.filter(
    (c) => c.status === "converted" && c.contactedAt && c.orderId && orders.find((x) => x.id === c.orderId)?.status !== "cancelado",
  );
  const revenue = recovered.reduce((s, c) => s + (orders.find((x) => x.id === c.orderId)?.total ?? 0), 0);
  return {
    // Convertida em minutos (a pessoa só estava terminando) não foi abandonada.
    abandoned: mine.filter((c) => c.status !== "converted" || c.contactedAt).length,
    contacted: mine.filter((c) => c.contactedAt).length,
    recovered: recovered.length,
    revenue,
  };
}

/** Espelho do trigger: pedido (que não é de mesa) com o mesmo WhatsApp converte a sacola aberta ou chamada. */
export function convertCarts(carts: AbandonedCart[], order: Pick<Order, "id" | "storeId" | "mode" | "customer">, now: Date): AbandonedCart[] {
  const phone = order.customer.phone.replace(/\D/g, "");
  if (!phone || order.mode === "table") return carts;
  return carts.map((c) =>
    c.storeId === order.storeId &&
    c.phone === phone &&
    (c.status === "open" || c.status === "contacted") &&
    now.getTime() - new Date(c.updatedAt).getTime() < CONVERT_DAYS * DAY
      ? { ...c, status: "converted", orderId: order.id, updatedAt: now.toISOString() }
      : c,
  );
}

/** "2× Isca de peixe, 1× Batata frita e mais 2 itens". */
export function cartItemsLabel(cart: Pick<AbandonedCart, "items">, max = 3): string {
  const parts = cart.items.slice(0, max).map((i) => `${i.quantity}× ${i.name}`);
  const rest = cart.items.length - max;
  if (rest > 0) parts.push(`mais ${rest} ${rest === 1 ? "item" : "itens"}`);
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} e ${parts[parts.length - 1]}`;
}

/** Mensagem pronta para o WhatsApp. O cupom é opcional. */
export function recoveryMessage(cart: AbandonedCart, store: Pick<Store, "name">, menuUrl: string, coupon?: Pick<Coupon, "code" | "kind" | "value">): string {
  const first = cart.name.trim().split(/\s+/)[0];
  const lines = [
    `Oi${first ? `, ${first}` : ""}! Aqui é do ${store.name}.`,
    `Vi que você montou um pedido com ${cartItemsLabel(cart)} (${formatMoney(cart.subtotal)}) e não chegou a finalizar. Ficou alguma dúvida? Posso ajudar por aqui.`,
    coupon ? `E tem um presente: com o cupom *${coupon.code}* você ganha ${couponLabel(coupon).toLowerCase()}.` : "",
    `Para finalizar, é só voltar pelo link (no mesmo celular, a sacola ainda está lá): ${menuUrl}`,
  ].filter(Boolean);
  return lines.join("\n\n");
}

export function recoveryLink(cart: Pick<AbandonedCart, "phone">, message: string): string {
  return `https://wa.me/55${cart.phone}?text=${encodeURIComponent(message)}`;
}
