"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/painel/page-header";
import { StoreSettings } from "@/components/painel/settings/store-settings";
import { HoursAndScheduling } from "@/components/painel/settings/schedule-settings";
import { DeliverySettings } from "@/components/painel/settings/delivery-settings";
import { PaymentSettings } from "@/components/painel/settings/payment-settings";
import { AccountSettings } from "@/components/painel/settings/account-settings";
import { usePainel } from "@/components/painel/painel-context";
import { cn } from "@/lib/cn";

const TABS = [
  { id: "loja", label: "Loja", view: StoreSettings },
  { id: "horarios", label: "Horários", view: HoursAndScheduling },
  { id: "atendimento", label: "Entrega e retirada", view: DeliverySettings },
  { id: "pagamento", label: "Pagamento", view: PaymentSettings },
  { id: "conta", label: "Conta", view: AccountSettings },
] as const;

export default function ConfiguracoesPage() {
  return (
    <Suspense>
      <Configuracoes />
    </Suspense>
  );
}

function Configuracoes() {
  const { store } = usePainel();
  const params = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get("aba")) ?? TABS[0];
  const View = tab.view;

  return (
    <div className="mx-auto max-w-[1152px] px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader title={tab.id === "loja" ? "Configurações" : tab.label} subtitle={store.name} />
      <nav
        aria-label="Áreas das configurações"
        className="mt-5 flex gap-5 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]"
      >
        {TABS.map((t) => {
          const on = t.id === tab.id;
          return (
            <Link
              key={t.id}
              href={t.id === "loja" ? "/painel/configuracoes" : `/painel/configuracoes?aba=${t.id}`}
              aria-current={on ? "page" : undefined}
              className={cn(
                "relative flex h-10 flex-none items-center text-sm whitespace-nowrap",
                on ? "font-semibold text-ink" : "text-muted hover:text-ink",
              )}
            >
              {t.label}
              {on && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-ink" />}
            </Link>
          );
        })}
      </nav>
      <div className="mt-6">
        {/* A key remonta o formulário quando a loja muda por fora (outra aba, restauração). */}
        <View key={`${tab.id}-${store.id}`} />
      </div>
    </div>
  );
}
