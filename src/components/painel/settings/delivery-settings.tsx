"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import type { Store } from "@/lib/types";
import { serviceFeeOf } from "@/lib/domain/tabs";
import { usePainel } from "@/components/painel/painel-context";
import { SaveBar, SettingsSection } from "@/components/painel/settings/section";
import { Field, Input, Switch, inputClass } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";
import { formatMoney, moneyInput, parseMoney } from "@/lib/format";
import { newId } from "@/lib/ids";
import { updateStore } from "@/lib/store/actions";
import { cn } from "@/lib/cn";

interface RegionDraft {
  id: string;
  name: string;
  feeText: string;
  active: boolean;
}

interface Form {
  deliveryEnabled: boolean;
  minOrderText: string;
  etaMin: string;
  etaMax: string;
  regions: RegionDraft[];
  pickupEnabled: boolean;
  pickupMin: string;
  pickupMax: string;
  tableEnabled: boolean;
  tableCount: string;
  feeEnabled: boolean;
  feeRate: string;
}

function pick(s: Store): Form {
  return {
    deliveryEnabled: s.delivery.enabled,
    minOrderText: s.delivery.minOrder ? moneyInput(s.delivery.minOrder) : "",
    etaMin: String(s.delivery.etaMin),
    etaMax: String(s.delivery.etaMax),
    regions: s.delivery.regions.map((r) => ({ id: r.id, name: r.name, feeText: moneyInput(r.fee), active: r.active })),
    pickupEnabled: s.pickup.enabled,
    pickupMin: String(s.pickup.etaMin),
    pickupMax: String(s.pickup.etaMax),
    tableEnabled: s.table.enabled,
    tableCount: String(s.table.count),
    feeEnabled: serviceFeeOf(s).enabled,
    feeRate: String(serviceFeeOf(s).rate),
  };
}

const digits = (v: string) => v.replace(/\D/g, "").slice(0, 3);

export function DeliverySettings() {
  const { store } = usePainel();
  const toast = useToast();
  const [form, setForm] = useState<Form>(() => pick(store));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(form) !== JSON.stringify(pick(store));
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const setRegion = (id: string, change: Partial<RegionDraft>) =>
    setForm((f) => ({ ...f, regions: f.regions.map((r) => (r.id === id ? { ...r, ...change } : r)) }));

  async function save() {
    const next: Record<string, string> = {};
    const minOrder = form.minOrderText.trim() ? parseMoney(form.minOrderText) : 0;
    if (minOrder === null) next.minOrder = "Valor inválido.";
    const etaMin = Number(form.etaMin);
    const etaMax = Number(form.etaMax);
    if (!etaMin || !etaMax || etaMin > etaMax) next.eta = "O tempo mínimo precisa ser menor ou igual ao máximo.";
    const pMin = Number(form.pickupMin);
    const pMax = Number(form.pickupMax);
    if (!pMin || !pMax || pMin > pMax) next.pickup = "O tempo mínimo precisa ser menor ou igual ao máximo.";
    const tableCount = Number(form.tableCount);
    if (!tableCount || tableCount > 200) next.table = "Informe de 1 a 200 mesas.";
    const feeRate = Number(form.feeRate);
    if (form.feeEnabled && (!feeRate || feeRate > 30)) next.fee = "Informe de 1% a 30%.";
    const original = pick(store);
    const feeChanged = form.feeEnabled !== original.feeEnabled || form.feeRate !== original.feeRate;
    const regions = form.regions.map((r) => {
      const fee = r.feeText.trim() ? parseMoney(r.feeText) : 0;
      if (!r.name.trim() || fee === null) next[`region:${r.id}`] = "Confira nome e taxa.";
      return { id: r.id, name: r.name.trim(), fee: fee ?? 0, active: r.active };
    });
    if (form.deliveryEnabled && !regions.some((r) => r.active)) next.regions = "Para entregar, ative pelo menos um bairro.";
    if (!form.deliveryEnabled && !form.pickupEnabled && !form.tableEnabled) next.form = "Deixe pelo menos uma forma de atendimento ligada.";
    setErrors(next);
    if (Object.keys(next).length) return;
    await attempt(
      toast,
      () =>
        updateStore(store.id, (s) => {
          s.delivery = { enabled: form.deliveryEnabled, minOrder: minOrder ?? 0, etaMin, etaMax, regions };
          s.pickup = { enabled: form.pickupEnabled, etaMin: pMin, etaMax: pMax };
          s.table = { enabled: form.tableEnabled, count: tableCount || s.table.count };
          // Antes do SQL 003 a loja do banco não tem a taxa: só grava quando o dono mexe nela.
          if (s.serviceFee || feeChanged) s.serviceFee = { enabled: form.feeEnabled, rate: form.feeEnabled ? feeRate : serviceFeeOf(s).rate };
        }),
      "Formas de atendimento salvas",
    );
  }

  const reset = () => {
    setForm(pick(store));
    setErrors({});
  };
  const activeFees = form.regions.filter((r) => r.active).map((r) => parseMoney(r.feeText) ?? 0);

  return (
    <div>
      <SettingsSection
        id="entrega"
        title="Entrega"
        description={
          <>
            <p>Você entrega com a sua equipe. O cliente escolhe o bairro e a taxa entra no total.</p>
            {form.deliveryEnabled && activeFees.length > 0 && (
              <p className="mt-3">
                O cliente vê: <span className="font-medium text-ink">Entrega a partir de {formatMoney(Math.min(...activeFees))} · {form.etaMin}–{form.etaMax} min</span>
              </p>
            )}
          </>
        }
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Aceitar pedidos para entrega</span>
          <Switch checked={form.deliveryEnabled} onChange={(v) => set("deliveryEnabled", v)} label="Aceitar pedidos para entrega" />
        </div>
        <div className={cn("mt-4 flex flex-col gap-4", !form.deliveryEnabled && "opacity-60")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pedido mínimo (R$)" hint="Deixe vazio para não ter mínimo." error={errors.minOrder}>
              {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={form.minOrderText} onChange={(e) => set("minOrderText", e.target.value)} />}
            </Field>
            <Field label="Tempo de entrega (minutos)" error={errors.eta}>
              {(p) => (
                <div className="flex items-center gap-2">
                  <Input {...p} inputMode="numeric" aria-label="Tempo mínimo" value={form.etaMin} onChange={(e) => set("etaMin", digits(e.target.value))} />
                  <span className="text-sm text-muted">a</span>
                  <Input inputMode="numeric" aria-label="Tempo máximo" value={form.etaMax} onChange={(e) => set("etaMax", digits(e.target.value))} />
                </div>
              )}
            </Field>
          </div>

          <div>
            <p className="text-sm font-medium">Bairros e taxas</p>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-1 font-normal">Bairro</th>
                  <th className="w-[112px] pb-1 text-right font-normal">Taxa (R$)</th>
                  <th className="w-[52px] pb-1 font-normal">
                    <span className="sr-only">Ativo</span>
                  </th>
                  <th className="w-[36px] pb-1">
                    <span className="sr-only">Remover</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {form.regions.map((r) => (
                  <tr key={r.id} className="border-t border-rule">
                    <td className="py-1.5 pr-2">
                      <input
                        aria-label="Nome do bairro"
                        aria-invalid={errors[`region:${r.id}`] ? true : undefined}
                        value={r.name}
                        onChange={(e) => setRegion(r.id, { name: e.target.value })}
                        className={cn(inputClass, "h-9")}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        aria-label={`Taxa de ${r.name || "bairro"}`}
                        inputMode="decimal"
                        value={r.feeText}
                        onChange={(e) => setRegion(r.id, { feeText: e.target.value })}
                        className={cn(inputClass, "num h-9 text-right")}
                      />
                    </td>
                    <td className="py-1.5">
                      <Switch checked={r.active} onChange={(v) => setRegion(r.id, { active: v })} label={`Entregar em ${r.name || "bairro"}`} />
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        type="button"
                        aria-label={`Remover ${r.name}`}
                        onClick={() => setForm((f) => ({ ...f, regions: f.regions.filter((x) => x.id !== r.id) }))}
                        className="grid size-8 place-items-center rounded-control text-muted hover:bg-pill-negative-bg hover:text-negative"
                      >
                        <Trash2 className="size-4" strokeWidth={1.5} />
                      </button>
                    </td>
                  </tr>
                ))}
                {form.regions.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-sm text-muted">
                      Nenhum bairro cadastrado.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, regions: [...f.regions, { id: newId(), name: "", feeText: "", active: true }] }))}
              className="mt-2 inline-flex h-8 items-center gap-1.5 text-sm font-medium text-accent hover:underline"
            >
              <Plus className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Adicionar bairro
            </button>
            {errors.regions && <p className="mt-1 text-xs text-negative">{errors.regions}</p>}
            {Object.keys(errors).some((k) => k.startsWith("region:")) && (
              <p className="mt-1 text-xs text-negative">Confira o nome e a taxa dos bairros marcados em vermelho.</p>
            )}
          </div>
        </div>
        <SaveBar dirty={dirty} onSave={save} onReset={reset} />
      </SettingsSection>

      <SettingsSection title="Retirada no balcão" description="O cliente paga e busca na loja. O endereço da loja aparece no fim do pedido.">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Aceitar pedidos para retirar</span>
          <Switch checked={form.pickupEnabled} onChange={(v) => set("pickupEnabled", v)} label="Aceitar pedidos para retirar" />
        </div>
        <Field label="Tempo até ficar pronto (minutos)" error={errors.pickup} className="mt-4">
          {(p) => (
            <div className="flex max-w-[280px] items-center gap-2">
              <Input {...p} inputMode="numeric" aria-label="Tempo mínimo" value={form.pickupMin} onChange={(e) => set("pickupMin", digits(e.target.value))} />
              <span className="text-sm text-muted">a</span>
              <Input inputMode="numeric" aria-label="Tempo máximo" value={form.pickupMax} onChange={(e) => set("pickupMax", digits(e.target.value))} />
            </div>
          )}
        </Field>
        <SaveBar dirty={dirty} onSave={save} onReset={reset} />
      </SettingsSection>

      <SettingsSection
        title="Mesas"
        description={
          <>
            O garçom abre a mesa e lança pelo celular; o cliente também pode pedir pelo QR code da mesa. Tudo cai na mesma
            comanda.{" "}
            <Link href="/painel/mesas?aba=qr" className="font-medium text-accent hover:underline">
              Imprimir os QR codes
            </Link>
          </>
        }
      >
        <Field label="Quantidade de mesas" error={errors.table} className="max-w-[200px]">
          {(p) => <Input {...p} inputMode="numeric" value={form.tableCount} onChange={(e) => set("tableCount", digits(e.target.value))} />}
        </Field>
        <div className="mt-5 flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Cliente pede pelo QR code da mesa</span>
            <span className="block text-xs text-muted">Desligado, só o garçom lança na mesa.</span>
          </span>
          <Switch checked={form.tableEnabled} onChange={(v) => set("tableEnabled", v)} label="Cliente pede pelo QR code da mesa" />
        </div>
        <div className="mt-5 flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Taxa de serviço</span>
            <span className="block text-xs text-muted">Entra na conta da mesa. O caixa pode tirar na hora, se o cliente pedir.</span>
          </span>
          <Switch checked={form.feeEnabled} onChange={(v) => set("feeEnabled", v)} label="Cobrar taxa de serviço" />
        </div>
        {form.feeEnabled && (
          <Field label="Percentual da taxa" error={errors.fee} className="mt-4 max-w-[200px]">
            {(p) => (
              <div className="flex items-center gap-2">
                <Input {...p} inputMode="numeric" value={form.feeRate} onChange={(e) => set("feeRate", digits(e.target.value).slice(0, 2))} />
                <span className="text-sm text-muted">%</span>
              </div>
            )}
          </Field>
        )}
        {errors.form && <p className="mt-3 text-sm text-negative">{errors.form}</p>}
        <SaveBar dirty={dirty} onSave={save} onReset={reset} />
      </SettingsSection>
    </div>
  );
}
