"use client";

import { useEffect, useState } from "react";
import type { StoreFiscal, TaxRegime } from "@/lib/types";
import { REGIME_LABEL, formatCnpj } from "@/lib/domain/fiscal";
import { fiscalProviderInfo, newStoreFiscal, saveStoreFiscal } from "@/lib/store/fiscal";
import { onlyDigits } from "@/lib/format";
import { usePainel } from "@/components/painel/painel-context";
import { SaveBar, SettingsSection } from "@/components/painel/settings/section";
import { Field, Input, Select, Switch } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";

/** Aba Fiscal: dados da loja para a NFC-e e situação do emissor. */
export function FiscalSettings() {
  const { db, store } = usePainel();
  const toast = useToast();
  const saved = (db.storeFiscal ?? []).find((f) => f.storeId === store.id) ?? newStoreFiscal(store.id);
  const exists = (db.storeFiscal ?? []).some((f) => f.storeId === store.id);
  const [form, setForm] = useState<StoreFiscal>({ ...saved, cnpj: saved.cnpj ? formatCnpj(saved.cnpj) : "" });
  const [provider, setProvider] = useState<{ provider: string; production: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify({ ...form, cnpj: onlyDigits(form.cnpj), updatedAt: "" }) !== JSON.stringify({ ...saved, updatedAt: "" }) || !exists;
  const set = <K extends keyof StoreFiscal>(k: K, v: StoreFiscal[K]) => setForm((f) => ({ ...f, [k]: v }));
  const simulator = provider?.provider === "simulador";

  useEffect(() => {
    let alive = true;
    void fiscalProviderInfo(store.id).then((p) => alive && setProvider(p));
    return () => {
      alive = false;
    };
  }, [store.id]);

  async function save() {
    setError(null);
    const ok = await attempt(toast, async () => {
      try {
        return await saveStoreFiscal(form);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Não foi possível salvar.");
        throw err;
      }
    }, form.enabled ? "Dados fiscais salvos. NFC-e ligada." : "Dados fiscais salvos");
    if (ok) setForm({ ...ok, cnpj: formatCnpj(ok.cnpj) });
  }

  return (
    <div>
      <SettingsSection
        title="Emissor fiscal"
        description={
          <p>
            A NFC-e é assinada com o certificado A1 do restaurante e autorizada pela SEFAZ por um emissor fiscal contratado pela Comanda. O
            certificado e o CSC vão direto para o emissor, nunca ficam guardados aqui.
          </p>
        }
      >
        {provider === null ? (
          <p className="text-sm text-muted">Conferindo o emissor…</p>
        ) : simulator ? (
          <div className="text-sm leading-6">
            <p className="font-medium">Simulador (sem valor fiscal)</p>
            <p className="text-muted">
              O emissor fiscal ainda não foi escolhido. Dá para testar todo o caminho (emitir, ver a chave de acesso, cancelar), mas as notas
              não vão para a SEFAZ e a produção fica bloqueada. Quando o emissor for ligado, aqui aparece o envio do certificado e do CSC.
            </p>
          </div>
        ) : (
          <p className="text-sm">
            Emissor: <strong>{provider.provider}</strong>
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        title="Dados da empresa"
        description={
          <p>
            Como estão no cadastro da SEFAZ. O regime e os códigos padrão valem para todos os itens; um item pode ter os próprios (no
            cardápio, em Dados fiscais). Confira com o seu contador.
          </p>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CNPJ">
              {(p) => <Input {...p} inputMode="numeric" placeholder="00.000.000/0000-00" value={form.cnpj} onChange={(e) => set("cnpj", formatCnpj(onlyDigits(e.target.value).slice(0, 14)) || onlyDigits(e.target.value))} />}
            </Field>
            <Field label="Inscrição estadual" hint="Só números.">
              {(p) => <Input {...p} inputMode="numeric" value={form.ie} onChange={(e) => set("ie", onlyDigits(e.target.value).slice(0, 14))} />}
            </Field>
          </div>
          <Field label="Razão social">
            {(p) => <Input {...p} maxLength={120} placeholder="Bar do Cais Comércio de Alimentos LTDA" value={form.legalName} onChange={(e) => set("legalName", e.target.value)} />}
          </Field>
          <Field label="Regime tributário">
            {(p) => (
              <Select {...p} value={form.regime} onChange={(e) => set("regime", e.target.value as TaxRegime)}>
                {(Object.keys(REGIME_LABEL) as TaxRegime[]).map((r) => (
                  <option key={r} value={r}>
                    {REGIME_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="NCM padrão" hint="Comida pronta: 21069090.">
              {(p) => <Input {...p} inputMode="numeric" className="font-mono" value={form.defaultNcm} onChange={(e) => set("defaultNcm", onlyDigits(e.target.value).slice(0, 8))} />}
            </Field>
            <Field label="CFOP padrão" hint="Venda: 5102.">
              {(p) => <Input {...p} inputMode="numeric" className="font-mono" value={form.defaultCfop} onChange={(e) => set("defaultCfop", onlyDigits(e.target.value).slice(0, 4))} />}
            </Field>
            <Field label={form.regime === "normal" ? "CST padrão" : "CSOSN padrão"} hint={form.regime === "normal" ? "Ex.: 00." : "Simples: 102."}>
              {(p) => <Input {...p} inputMode="numeric" className="font-mono" value={form.defaultTaxCode} onChange={(e) => set("defaultTaxCode", onlyDigits(e.target.value).slice(0, 3))} />}
            </Field>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Emissão"
        description={
          <p>
            Homologação é o ambiente de teste da SEFAZ: a nota não vale. Ligue a produção só depois de testar com o certificado e o CSC de
            produção. A nota sai pelo botão Emitir NFC-e no pedido; a de mesa sai pela comanda (em breve).
          </p>
        }
      >
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Emitir NFC-e</span>
            <span className="block text-xs text-muted">Mostra o botão de emitir nos pedidos de balcão, retirada e entrega.</span>
          </span>
          <Switch checked={form.enabled} onChange={(v) => set("enabled", v)} label="Emitir NFC-e" />
        </div>
        <div role="radiogroup" aria-label="Ambiente" className="mt-4 grid grid-cols-2 gap-2">
          {(
            [
              ["homologacao", "Homologação (teste)"],
              ["producao", "Produção"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={form.environment === value}
              disabled={value === "producao" && simulator}
              onClick={() => set("environment", value)}
              className={
                form.environment === value
                  ? "h-10 rounded-control border border-accent bg-accent-soft text-sm font-medium text-accent"
                  : "h-10 rounded-control border border-control text-sm font-medium hover:bg-raised disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {label}
            </button>
          ))}
        </div>
        {simulator && <p className="mt-2 text-xs text-muted">Produção libera quando o emissor fiscal for ligado.</p>}
        {error && <p className="mt-3 text-sm text-negative">{error}</p>}
        <SaveBar dirty={dirty} onSave={save} onReset={() => setForm({ ...saved, cnpj: saved.cnpj ? formatCnpj(saved.cnpj) : "" })} />
      </SettingsSection>
    </div>
  );
}
