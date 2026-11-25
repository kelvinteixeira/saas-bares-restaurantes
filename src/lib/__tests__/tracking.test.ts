import { describe, expect, it } from "vitest";
import { gaEvent, hasTracking, metaEvent, normalizeGaId, normalizeMetaPixel, purchaseOf, trackingOf } from "@/lib/domain/tracking";

describe("pixel e analytics", () => {
  it("aceita só os formatos exatos (o ID vai dentro de <script>)", () => {
    expect(trackingOf({ tracking: { metaPixelId: "123456789012345", gaId: "G-ABC123XYZ" } })).toEqual({
      metaPixelId: "123456789012345",
      gaId: "G-ABC123XYZ",
    });
    expect(trackingOf({ tracking: { metaPixelId: '123"></script><script>alert(1)', gaId: "UA-1234-1" } })).toEqual({ metaPixelId: null, gaId: null });
    expect(trackingOf({ tracking: { metaPixelId: "123" } }).metaPixelId).toBeNull();
    expect(trackingOf({})).toEqual({ metaPixelId: null, gaId: null });
    expect(hasTracking({ tracking: { gaId: "G-ABC123" } })).toBe(true);
    expect(hasTracking({ tracking: { gaId: "g-abc123" } })).toBe(false);
  });

  it("limpa o que o dono cola", () => {
    expect(normalizeMetaPixel(" 1234 5678-9012 ")).toBe("123456789012");
    expect(normalizeGaId(" g-abc 123 ")).toBe("G-ABC123");
  });

  it("compra: valor em reais, BRL, e o pedido como chave para não contar duas vezes", () => {
    const order = {
      id: "ord-1",
      total: 4700,
      deliveryFee: 500,
      items: [{ productId: "p1", name: "Isca", unitPrice: 2100, quantity: 2, options: [] }],
    };
    const [name, data, options] = metaEvent(purchaseOf(order));
    expect(name).toBe("Purchase");
    expect(data).toMatchObject({ value: 47, currency: "BRL", content_ids: ["p1"], num_items: 2 });
    expect(options).toEqual({ eventID: "ord-1" });
    const [gaName, gaData] = gaEvent(purchaseOf(order));
    expect(gaName).toBe("purchase");
    expect(gaData).toMatchObject({ transaction_id: "ord-1", value: 47, shipping: 5, currency: "BRL" });
    expect((gaData.items as { price: number }[])[0].price).toBe(21);
  });

  it("item visto e adicionado à sacola", () => {
    const item = { id: "p1", name: "Isca", price: 4250, quantity: 2 };
    expect(metaEvent({ name: "view_item", item })[0]).toBe("ViewContent");
    expect(metaEvent({ name: "add_to_cart", item })[1]).toMatchObject({ value: 85 });
    expect(gaEvent({ name: "add_to_cart", item })[1]).toMatchObject({ value: 85 });
    expect(gaEvent({ name: "begin_checkout", items: [item], value: 8500 })).toEqual([
      "begin_checkout",
      { currency: "BRL", value: 85, items: [{ item_id: "p1", item_name: "Isca", price: 42.5, quantity: 2 }] },
    ]);
  });
});
