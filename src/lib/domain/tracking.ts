import type { Order, Product, Store } from "@/lib/types";

// Pixel da Meta (Facebook e Instagram) e Google Analytics 4 no cardápio público.
// Os códigos vão parar dentro de <script>: só passam se tiverem o formato exato (o banco confere igual, SQL 010).

export const META_PIXEL_PATTERN = /^\d{10,20}$/;
export const GA_ID_PATTERN = /^G-[A-Z0-9]{4,16}$/;

export interface Tracking {
  metaPixelId?: string;
  gaId?: string;
}

/** O ID do Pixel é só número; aceita colar com espaço ou pontuação. */
export const normalizeMetaPixel = (input: string) => input.replace(/\D/g, "");
/** "g-abc123" → "G-ABC123". */
export const normalizeGaId = (input: string) => input.trim().toUpperCase().replace(/\s/g, "");

/** Só os códigos válidos da loja (inválido vale como desligado). */
export function trackingOf(store: Pick<Store, "tracking">): { metaPixelId: string | null; gaId: string | null } {
  const t = store.tracking ?? {};
  return {
    metaPixelId: t.metaPixelId && META_PIXEL_PATTERN.test(t.metaPixelId) ? t.metaPixelId : null,
    gaId: t.gaId && GA_ID_PATTERN.test(t.gaId) ? t.gaId : null,
  };
}

export const hasTracking = (store: Pick<Store, "tracking">) => {
  const t = trackingOf(store);
  return Boolean(t.metaPixelId || t.gaId);
};

export interface TrackItem {
  id: string;
  name: string;
  /** Centavos. */
  price: number;
  quantity: number;
}

export type TrackEvent =
  | { name: "view_item"; item: TrackItem }
  | { name: "add_to_cart"; item: TrackItem }
  | { name: "begin_checkout"; items: TrackItem[]; value: number }
  | { name: "purchase"; orderId: string; items: TrackItem[]; value: number; shipping: number };

const reais = (cents: number) => Math.round(cents) / 100;

export const productItem = (p: Pick<Product, "id" | "name">, price: number, quantity = 1): TrackItem => ({ id: p.id, name: p.name, price, quantity });

export function orderItems(order: Pick<Order, "items">): TrackItem[] {
  return order.items.map((it) => ({ id: it.productId, name: it.name, price: it.unitPrice, quantity: it.quantity }));
}

export function purchaseOf(order: Pick<Order, "id" | "items" | "total" | "deliveryFee">): TrackEvent {
  return { name: "purchase", orderId: order.id, items: orderItems(order), value: order.total, shipping: order.deliveryFee };
}

/** Evento padrão da Meta: [nome, dados, opções (eventID para não contar duas vezes)]. */
export function metaEvent(e: TrackEvent): [string, Record<string, unknown>, { eventID: string } | undefined] {
  const contents = (items: TrackItem[]) => items.map((i) => ({ id: i.id, quantity: i.quantity, item_price: reais(i.price) }));
  switch (e.name) {
    case "view_item":
      return ["ViewContent", { content_type: "product", content_ids: [e.item.id], content_name: e.item.name, value: reais(e.item.price), currency: "BRL" }, undefined];
    case "add_to_cart":
      return [
        "AddToCart",
        { content_type: "product", content_ids: [e.item.id], contents: contents([e.item]), value: reais(e.item.price * e.item.quantity), currency: "BRL" },
        undefined,
      ];
    case "begin_checkout":
      return [
        "InitiateCheckout",
        { content_type: "product", content_ids: e.items.map((i) => i.id), contents: contents(e.items), num_items: e.items.reduce((s, i) => s + i.quantity, 0), value: reais(e.value), currency: "BRL" },
        undefined,
      ];
    case "purchase":
      return [
        "Purchase",
        { content_type: "product", content_ids: e.items.map((i) => i.id), contents: contents(e.items), num_items: e.items.reduce((s, i) => s + i.quantity, 0), value: reais(e.value), currency: "BRL" },
        { eventID: e.orderId },
      ];
  }
}

/** Evento recomendado do GA4 (comércio eletrônico). */
export function gaEvent(e: TrackEvent): [string, Record<string, unknown>] {
  const items = (list: TrackItem[]) => list.map((i) => ({ item_id: i.id, item_name: i.name, price: reais(i.price), quantity: i.quantity }));
  switch (e.name) {
    case "view_item":
      return ["view_item", { currency: "BRL", value: reais(e.item.price), items: items([e.item]) }];
    case "add_to_cart":
      return ["add_to_cart", { currency: "BRL", value: reais(e.item.price * e.item.quantity), items: items([e.item]) }];
    case "begin_checkout":
      return ["begin_checkout", { currency: "BRL", value: reais(e.value), items: items(e.items) }];
    case "purchase":
      return ["purchase", { transaction_id: e.orderId, currency: "BRL", value: reais(e.value), shipping: reais(e.shipping), items: items(e.items) }];
  }
}
