"use client";

import Link from "next/link";
import { Copy, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { usePainel } from "@/components/painel/painel-context";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export default function MesasPage() {
  const { store } = usePainel();
  const toast = useToast();
  // As telas do painel só renderizam no navegador, depois de carregar os dados.
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  const menuUrl = `${origin}/${store.slug}`;
  const tables = store.table.enabled ? Array.from({ length: store.table.count }, (_, i) => i + 1) : [];

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copiado");
    } catch {
      toast("Não foi possível copiar. Selecione o link e copie.", "negative");
    }
  }

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        className="no-print"
        title="Mesas e QR code"
        subtitle={
          store.table.enabled
            ? `${store.table.count} mesas. Cada QR abre o cardápio com a mesa já marcada no pedido.`
            : "O pedido na mesa está desligado. Os clientes ainda podem usar o QR geral do cardápio."
        }
        actions={
          <Button variant="primary" onClick={() => window.print()}>
            <Printer className="size-4" strokeWidth={1.5} aria-hidden="true" />
            Imprimir QR codes
          </Button>
        }
      />

      {!store.table.enabled && (
        <p className="no-print mt-5 rounded-card bg-pill-warning-bg px-4 py-3 text-sm text-pill-warning-ink">
          Para gerar um QR por mesa, ligue &quot;Pedido na mesa&quot; em{" "}
          <Link href="/painel/configuracoes?aba=atendimento" className="font-medium underline">
            Entrega e retirada
          </Link>
          .
        </p>
      )}

      {origin && (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 print:grid-cols-3">
          <QrCard title="Cardápio" subtitle="Entrega e retirada" url={menuUrl} storeName={store.name} onCopy={copy} />
          {tables.map((n) => (
            <QrCard
              key={n}
              title={`Mesa ${n}`}
              subtitle="Peça pelo celular"
              url={`${menuUrl}?mesa=${n}`}
              storeName={store.name}
              onCopy={copy}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function QrCard({
  title,
  subtitle,
  url,
  storeName,
  onCopy,
}: {
  title: string;
  subtitle: string;
  url: string;
  storeName: string;
  onCopy: (url: string) => void;
}) {
  return (
    <li className="flex break-inside-avoid flex-col items-center rounded-card border border-line p-4 text-center">
      <p className="text-xs text-muted">{storeName}</p>
      <p className="text-lg font-semibold">{title}</p>
      <QRCodeSVG value={url} size={148} level="M" marginSize={2} className="mt-2 h-auto w-full max-w-[148px]" title={`QR code de ${title}`} />
      <p className="mt-2 text-[13px]">{subtitle}</p>
      <button
        type="button"
        onClick={() => onCopy(url)}
        className="no-print mt-3 inline-flex h-8 items-center gap-1.5 rounded-control px-2 text-[13px] font-medium text-accent hover:bg-accent-soft"
      >
        <Copy className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        Copiar link
      </button>
    </li>
  );
}
