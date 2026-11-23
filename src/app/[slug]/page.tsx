import { PublicMenu } from "@/components/cardapio/public-menu";

export default async function CardapioPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const raw = Array.isArray(sp.mesa) ? sp.mesa[0] : sp.mesa;
  const mesa = raw && /^\d{1,3}$/.test(raw) ? Number(raw) : null;
  return <PublicMenu slug={slug} mesa={mesa} />;
}
