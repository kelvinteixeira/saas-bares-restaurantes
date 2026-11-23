import type { Order, OrderMode, OrderStatus } from "@/lib/types";

const FLOW: Record<OrderMode, OrderStatus[]> = {
  delivery: ["novo", "em_preparo", "pronto", "a_caminho", "concluido"],
  pickup: ["novo", "em_preparo", "pronto", "concluido"],
  table: ["novo", "em_preparo", "pronto", "concluido"],
};

export function statusFlow(mode: OrderMode): OrderStatus[] {
  return FLOW[mode];
}

export function nextStatus(order: Pick<Order, "mode" | "status">): OrderStatus | null {
  const flow = FLOW[order.mode];
  const i = flow.indexOf(order.status);
  if (i === -1 || i === flow.length - 1) return null;
  return flow[i + 1];
}

export function canCancel(order: Pick<Order, "status">): boolean {
  return order.status === "novo" || order.status === "em_preparo" || order.status === "pronto";
}

export function isOpenOrder(order: Pick<Order, "status">): boolean {
  return order.status !== "concluido" && order.status !== "cancelado";
}

/** Rótulo do botão que leva o pedido ao próximo status. */
export function advanceLabel(order: Pick<Order, "mode" | "status">): string | null {
  const next = nextStatus(order);
  if (!next) return null;
  if (next === "em_preparo") return "Aceitar";
  if (next === "pronto") return "Marcar pronto";
  if (next === "a_caminho") return "Saiu para entrega";
  if (order.mode === "delivery") return "Entregue";
  if (order.mode === "pickup") return "Retirado";
  return "Servido";
}

/** Nome do status como o dono vê no painel. */
export function statusLabel(status: OrderStatus, mode: OrderMode): string {
  switch (status) {
    case "novo":
      return "Novo";
    case "em_preparo":
      return "Em preparo";
    case "pronto":
      return mode === "delivery" ? "Pronto, aguardando entregador" : mode === "pickup" ? "Pronto para retirar" : "Pronto para servir";
    case "a_caminho":
      return "A caminho";
    case "concluido":
      return mode === "delivery" ? "Entregue" : mode === "pickup" ? "Retirado" : "Servido";
    case "cancelado":
      return "Cancelado";
  }
}

/** Frase para o cliente na página de acompanhamento. */
export function customerStatusLabel(status: OrderStatus, mode: OrderMode): string {
  switch (status) {
    case "novo":
      return "Pedido enviado, aguardando a loja aceitar";
    case "em_preparo":
      return "A cozinha está preparando seu pedido";
    case "pronto":
      return mode === "delivery"
        ? "Pronto, aguardando o entregador"
        : mode === "pickup"
          ? "Pronto, pode vir retirar"
          : "Pronto, já vai para a sua mesa";
    case "a_caminho":
      return "Saiu para entrega";
    case "concluido":
      return mode === "delivery" ? "Entregue" : mode === "pickup" ? "Retirado" : "Servido na mesa";
    case "cancelado":
      return "Pedido cancelado pela loja";
  }
}

export function modeLabel(mode: OrderMode): string {
  return mode === "delivery" ? "Entrega" : mode === "pickup" ? "Retirada" : "Mesa";
}

export function applyStatus(order: Order, status: OrderStatus, at: Date): Order {
  return { ...order, status, history: [...order.history, { status, at: at.toISOString() }] };
}

export function isLate(order: Pick<Order, "status" | "promisedAt">, now: Date): boolean {
  return isOpenOrder(order) && now.getTime() > new Date(order.promisedAt).getTime();
}
