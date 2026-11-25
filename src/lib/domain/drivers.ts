import type { Driver, Order, Store } from "@/lib/types";
import { formatMoney, formatOrderNumber, formatPhone } from "@/lib/format";

// Entregadores. O banco (SQL 009, assign_driver) aplica as mesmas regras: só pedido de entrega,
// entregador ativo da loja, e o valor do acerto guardado no pedido na hora da escolha.

export function payFor(driver: Pick<Driver, "payKind" | "payAmount">, order: Pick<Order, "deliveryFee">): number {
  return driver.payKind === "fee" ? order.deliveryFee : driver.payAmount;
}

export function payLabel(driver: Pick<Driver, "payKind" | "payAmount">): string {
  return driver.payKind === "fee" ? "recebe a taxa de entrega" : `${formatMoney(driver.payAmount)} por entrega`;
}

export interface DriverSettlement {
  driver: Driver | null;
  /** Entregas válidas (não canceladas) no período. */
  orders: Order[];
  pay: number;
  /** Pedidos pagos em dinheiro na entrega: o entregador volta com esse valor (o troco já sai dele). */
  cash: number;
}

const inRange = (iso: string, from: Date, to: Date) => {
  const t = new Date(iso).getTime();
  return t >= from.getTime() && t < to.getTime();
};

/** Acerto do período por entregador (entregas com entregador, pelo dia do pedido). */
export function settlements(drivers: Driver[], orders: Order[], storeId: string, from: Date, to: Date): DriverSettlement[] {
  const list = orders.filter(
    (o) => o.storeId === storeId && o.mode === "delivery" && o.driverId && o.status !== "cancelado" && inRange(o.createdAt, from, to),
  );
  const mine = drivers.filter((d) => d.storeId === storeId);
  const ids = [...new Set(list.map((o) => o.driverId!))];
  return ids
    .map((id) => {
      const orders = list.filter((o) => o.driverId === id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return {
        driver: mine.find((d) => d.id === id) ?? null,
        orders,
        pay: orders.reduce((s, o) => s + (o.driverPay ?? 0), 0),
        cash: orders.filter((o) => o.payment.method === "cash").reduce((s, o) => s + o.total, 0),
      };
    })
    .sort((a, b) => b.orders.length - a.orders.length);
}

/**
 * Link do WhatsApp com o pedido para o entregador: endereço, cliente, cobrança e mapa.
 * `due` é o que ainda falta receber (o caixa pode já ter registrado o pagamento).
 */
export function dispatchLink(order: Order, store: Pick<Store, "name">, driver: Pick<Driver, "phone" | "name">, due = order.total): string {
  const d = order.delivery;
  const address = d ? `${d.street}, ${d.number}${d.complement ? ` (${d.complement})` : ""} · ${d.regionName}` : "";
  const method = order.payment.method;
  const charge =
    due <= 0
      ? `Já está pago: não cobrar (total ${formatMoney(order.total)})`
      : method === "cash"
        ? `Cobrar ${formatMoney(due)} em dinheiro${order.payment.changeFor && due === order.total ? ` (troco para ${formatMoney(order.payment.changeFor)})` : ""}`
        : method === "card"
          ? `Cobrar ${formatMoney(due)} no cartão (levar a maquininha)`
          : `Cobrar ${formatMoney(due)} no Pix`;
  const lines = [
    `*${store.name}* · pedido ${formatOrderNumber(order.number)}`,
    `Cliente: ${order.customer.name}${order.customer.phone ? ` · ${formatPhone(order.customer.phone)}` : ""}`,
    `Endereço: ${address}`,
    d?.reference ? `Referência: ${d.reference}` : "",
    charge,
    d ? `Mapa: https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.street} ${d.number} ${d.regionName}`)}` : "",
  ].filter(Boolean);
  const phone = driver.phone ? `55${driver.phone}` : "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}`;
}
