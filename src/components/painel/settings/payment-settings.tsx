"use client";

import { useState } from "react";
import type { Store } from "@/lib/types";
import { usePainel } from "@/components/painel/painel-context";
import { SaveBar, SettingsSection } from "@/components/painel/settings/section";
import { Switch } from "@/components/ui/field";
import { Pill } from "@/components/ui/pill";
import { attempt, useToast } from "@/components/ui/toast";
import { updateStore } from "@/lib/store/actions";

const OPTIONS: { key: keyof Store["payment"]; title: string; description: string }[] = [
  { key: "pix", title: "Pix na entrega ou no balcão", description: "O cliente paga com a sua chave Pix quando recebe." },
  { key: "card", title: "Cartão na entrega ou no balcão", description: "Leve a maquininha na entrega." },
  { key: "cash", title: "Dinheiro", description: "O cliente informa se precisa de troco e para quanto." },
];

export function PaymentSettings() {
  const { store } = usePainel();
  const toast = useToast();
  const [payment, setPayment] = useState(store.payment);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(payment) !== JSON.stringify(store.payment);

  return (
    <div>
      <SettingsSection title="Formas de pagamento" description="O que o cliente pode escolher ao fechar o pedido. O pagamento acontece na entrega, no balcão ou na mesa.">
        <ul>
          {OPTIONS.map((o) => (
            <li key={o.key} className="flex items-center justify-between gap-4 border-t border-rule py-3 first:border-t-0 first:pt-0">
              <span>
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="block text-sm text-muted">{o.description}</span>
              </span>
              <Switch checked={payment[o.key]} label={o.title} onChange={(v) => setPayment((p) => ({ ...p, [o.key]: v }))} />
            </li>
          ))}
        </ul>
        {error && <p className="mt-2 text-sm text-negative">{error}</p>}
        <SaveBar
          dirty={dirty}
          onReset={() => {
            setPayment(store.payment);
            setError(null);
          }}
          onSave={async () => {
            if (!payment.pix && !payment.card && !payment.cash) {
              setError("Deixe pelo menos uma forma de pagamento ligada.");
              return;
            }
            setError(null);
            await attempt(
              toast,
              () =>
                updateStore(store.id, (s) => {
                  s.payment = payment;
                }),
              "Formas de pagamento salvas",
            );
          }}
        />
      </SettingsSection>

      <SettingsSection
        title="Pagamento online"
        description="Pix com QR code gerado no pedido e cartão de crédito pelo celular, com confirmação automática no painel."
      >
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm leading-6">
            Entra na próxima etapa, junto com o banco de dados e o provedor de pagamento. Os pedidos já guardam a forma de
            pagamento escolhida, então o painel não muda.
          </p>
          <Pill tone="warning">Próxima etapa</Pill>
        </div>
      </SettingsSection>
    </div>
  );
}
