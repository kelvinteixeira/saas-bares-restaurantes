import type { Metadata } from "next";
import { CartProvider } from "@/components/cardapio/cart";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: "Cardápio",
};

export default async function CardapioLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <ToastProvider>
      <CartProvider slug={slug}>{children}</CartProvider>
    </ToastProvider>
  );
}
