"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChefHat, HandPlatter, ReceiptText } from "lucide-react";
import { tableMap, type TableState } from "@/lib/domain/tabs";
import { formatDuration, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { usePainel } from "@/components/painel/painel-context";
import { PageHeader } from "@/components/painel/page-header";
import { QrCodes } from "@/components/painel/mesas/qr-codes";

export default function MesasPage() {
  return (
    <Suspense>
      <Mesas />
    </Suspense>
  );
}

function Mesas() {
  const params = useSearchParams();
  const qr = params.get("aba") === "qr";
  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <nav aria-label="Mesas" className="no-print mb-5 flex gap-5 border-b border-line">
        {[
          { href: "/painel/mesas", label: "Salão", on: !qr },
          { href: "/painel/mesas?aba=qr", label: "QR codes", on: qr },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.on ? "page" : undefined}
            className={cn("relative flex h-10 items-center text-sm", t.on ? "font-semibold text-ink" : "text-muted hover:text-ink")}
          >
            {t.label}
            {t.on && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-ink" />}
          </Link>
        ))}
      </nav>
      {qr ? <QrCodes /> : <Salao />}
    </div>
  );
}

function Salao() {
  const { db, store, now } = usePainel();
  const tables = tableMap(store, db.tabs ?? [], db.orders, now);
  const busy = tables.filter((t) => t.status === "open").length;
  const bill = tables.filter((t) => t.status === "bill_requested").length;
  const free = tables.length - busy - bill;

  return (
    <>
      <PageHeader
        title="Mesas"
        subtitle={
          tables.length
            ? `${busy} ${busy === 1 ? "ocupada" : "ocupadas"} · ${bill} ${bill === 1 ? "pediu" : "pediram"} a conta · ${free} ${free === 1 ? "livre" : "livres"}`
            : undefined
        }
      />
      {tables.length === 0 ? (
        <p className="mt-6 max-w-[640px] rounded-card bg-pill-warning-bg px-4 py-3 text-sm text-pill-warning-ink">
          Nenhuma mesa cadastrada. Informe quantas mesas o salão tem em{" "}
          <Link href="/painel/configuracoes?aba=atendimento" className="font-medium underline">
            Configurações › Entrega e retirada
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(168px,1fr))]">
          {tables.map((t) => (
            <TableCard key={t.number} table={t} />
          ))}
        </ul>
      )}
    </>
  );
}

function TableCard({ table }: { table: TableState }) {
  const free = table.status === "free";
  const bill = table.status === "bill_requested";
  return (
    <li>
      <Link
        href={`/painel/mesas/${table.number}`}
        className={cn(
          "flex h-full min-h-[128px] flex-col rounded-card border p-3.5 transition-colors",
          free && "border-line bg-surface hover:bg-raised",
          table.status === "open" && "border-accent/40 bg-accent-soft/60 hover:bg-accent-soft",
          bill && "border-[#e0b24a] bg-pill-warning-bg hover:brightness-[0.98]",
        )}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="num text-[28px] leading-8 font-semibold tracking-tight">{table.number}</span>
          {!free && <span className="num text-[13px] text-muted">{formatDuration(table.minutes)}</span>}
        </span>
        {free ? (
          <span className="mt-auto text-sm text-muted">Livre</span>
        ) : (
          <span className="mt-auto flex flex-col gap-1.5">
            <span className={cn("flex items-center gap-1.5 text-[13px] font-medium", bill ? "text-pill-warning-ink" : "text-accent")}>
              {bill && <ReceiptText className="size-3.5" strokeWidth={1.75} aria-hidden="true" />}
              {bill ? "Pediu a conta" : "Ocupada"}
            </span>
            <span className="num text-[15px] font-semibold">{formatMoney(table.totals?.total ?? 0)}</span>
            {(table.cooking > 0 || table.ready > 0) && (
              <span className="flex flex-wrap gap-x-2.5 gap-y-1 text-xs">
                {table.cooking > 0 && (
                  <span className="flex items-center gap-1 text-muted">
                    <ChefHat className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                    {table.cooking} na cozinha
                  </span>
                )}
                {table.ready > 0 && (
                  <span className="flex items-center gap-1 font-medium text-positive">
                    <HandPlatter className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                    {table.ready} {table.ready === 1 ? "pronto" : "prontos"} para servir
                  </span>
                )}
              </span>
            )}
          </span>
        )}
      </Link>
    </li>
  );
}
