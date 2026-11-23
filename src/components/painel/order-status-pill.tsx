import type { Order } from "@/lib/types";
import { statusLabel } from "@/lib/domain/orders";
import { Pill } from "@/components/ui/pill";

/** Um só marcador de status por pedido: amarelo pede ação, cinza é andamento, verde é fim. */
export function OrderStatusPill({ order }: { order: Pick<Order, "status" | "mode"> }) {
  const tone =
    order.status === "novo"
      ? "warning"
      : order.status === "concluido"
        ? "positive"
        : order.status === "cancelado"
          ? "negative"
          : order.status === "pronto"
            ? "accent"
            : "neutral";
  const label = order.status === "pronto" ? "Pronto" : statusLabel(order.status, order.mode);
  return <Pill tone={tone}>{label}</Pill>;
}
