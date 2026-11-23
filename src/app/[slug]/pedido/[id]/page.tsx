import { OrderTracking } from "@/components/cardapio/order-tracking";

export default async function PedidoPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  return <OrderTracking slug={slug} id={id} />;
}
