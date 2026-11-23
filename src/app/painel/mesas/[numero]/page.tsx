import { TabScreen } from "@/components/painel/mesas/tab-screen";

export default async function MesaPage({ params }: { params: Promise<{ numero: string }> }) {
  const { numero } = await params;
  return <TabScreen table={Number(numero)} />;
}
