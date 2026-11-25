"use client";

import { useState } from "react";
import { schedulingOf } from "@/lib/domain/schedule";
import { updateStore } from "@/lib/store/actions";
import { usePainel } from "@/components/painel/painel-context";
import { SaveBar, SettingsSection } from "@/components/painel/settings/section";
import { HoursSettings } from "@/components/painel/settings/hours-settings";
import { Input, Switch } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";

/** Aba Horários: o expediente e o pedido agendado. */
export function HoursAndScheduling() {
  return (
    <div>
      <HoursSettings />
      <ScheduleSettings />
    </div>
  );
}

function ScheduleSettings() {
  const { store } = usePainel();
  const toast = useToast();
  const cfg = schedulingOf(store);
  const [enabled, setEnabled] = useState(cfg.enabled);
  const [lead, setLead] = useState(String(cfg.leadMinutes));
  const [days, setDays] = useState(String(cfg.maxDays));
  const [error, setError] = useState<string | null>(null);
  const dirty = enabled !== cfg.enabled || Number(lead) !== cfg.leadMinutes || Number(days) !== cfg.maxDays;

  async function save() {
    const leadMinutes = Number(lead);
    const maxDays = Number(days);
    if (!leadMinutes || leadMinutes < 15 || leadMinutes > 1440) return setError("A antecedência vai de 15 a 1440 minutos (24 horas).");
    if (!maxDays || maxDays < 1 || maxDays > 14) return setError("Dá para liberar de 1 a 14 dias à frente.");
    setError(null);
    await attempt(
      toast,
      async () => {
        try {
          await updateStore(store.id, (s) => {
            s.scheduling = { enabled, leadMinutes, maxDays };
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "";
          if (/scheduling|column|schema cache/i.test(message)) {
            throw new Error("O agendamento ainda não está ligado no banco. Rode o arquivo supabase/migrations/008_agendamento.sql no Supabase.");
          }
          throw err;
        }
      },
      enabled ? "Pedido agendado ligado" : "Agendamento salvo",
    );
  }

  return (
    <SettingsSection
      title="Pedido agendado"
      description={
        <p>
          O cliente escolhe dia e horário (de 30 em 30 minutos, dentro dos horários acima). Com a loja fechada, o cardápio continua
          aceitando pedidos para mais tarde. Pedido na mesa não agenda. O pedido aparece na hora no painel, e na tela de preparo só
          perto do horário.
        </p>
      }
    >
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">Aceitar pedidos agendados</span>
        <Switch checked={enabled} onChange={setEnabled} label="Aceitar pedidos agendados" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-2 text-sm font-medium">
          Antecedência mínima
          <span className="flex items-center gap-2">
            <Input inputMode="numeric" className="max-w-[100px]" value={lead} onChange={(e) => setLead(e.target.value.replace(/\D/g, "").slice(0, 4))} />
            <span className="font-normal text-muted">min</span>
          </span>
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Até quantos dias à frente
          <span className="flex items-center gap-2">
            <Input inputMode="numeric" className="max-w-[100px]" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, "").slice(0, 2))} />
            <span className="font-normal text-muted">dias</span>
          </span>
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-negative">{error}</p>}
      <SaveBar
        dirty={dirty}
        onSave={save}
        onReset={() => {
          setEnabled(cfg.enabled);
          setLead(String(cfg.leadMinutes));
          setDays(String(cfg.maxDays));
          setError(null);
        }}
      />
    </SettingsSection>
  );
}
