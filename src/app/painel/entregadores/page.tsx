"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Driver } from "@/lib/types";
import { payLabel, settlements } from "@/lib/domain/drivers";
import { PERIOD_LABEL, periodRange, type Period } from "@/lib/domain/reports";
import { canManageStore } from "@/lib/domain/roles";
import { formatMoney, formatOrderNumber, formatPhone, moneyInput, parseMoney } from "@/lib/format";
import { deleteDriver, newDriver, saveDriver } from "@/lib/store/drivers";
import { cn } from "@/lib/cn";
import { usePainel } from "@/components/painel/painel-context";
import { Card, PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { attempt, useToast } from "@/components/ui/toast";

const PERIODS: Period[] = ["hoje", "ontem", "7dias"];

export default function EntregadoresPage() {
  const { db, store, now, role } = usePainel();
  const toast = useToast();
  const manage = canManageStore(role);
  const [period, setPeriod] = useState<Period>("hoje");
  const [editing, setEditing] = useState<Driver | null>(null);
  const [removing, setRemoving] = useState<Driver | null>(null);
  const drivers = (db.drivers ?? []).filter((d) => d.storeId === store.id).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  const { from, to } = periodRange(period, now);
  const rows = settlements(drivers, db.orders, store.id, from, to);
  const waiting = db.orders.filter(
    (o) => o.storeId === store.id && o.mode === "delivery" && !o.driverId && ["novo", "preparando", "pronto"].includes(o.status),
  ).length;

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        title="Entregadores"
        subtitle="Escolha o entregador no pedido e mande tudo pelo WhatsApp. No fim do dia, o acerto sai pronto aqui."
        actions={
          manage && (
            <Button variant="primary" onClick={() => setEditing(newDriver(store.id))}>
              <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
              Novo entregador
            </Button>
          )
        }
      />

      {waiting > 0 && drivers.some((d) => d.active) && (
        <p className="mt-4 rounded-control bg-pill-warning-bg px-4 py-2.5 text-sm text-pill-warning-ink">
          {waiting === 1 ? "1 entrega em andamento ainda não tem entregador." : `${waiting} entregas em andamento ainda não têm entregador.`} Escolha no
          detalhe do pedido.
        </p>
      )}

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold">Acerto</h2>
          <div role="radiogroup" aria-label="Período do acerto" className="flex rounded-[10px] bg-raised p-1">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={period === p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "h-8 rounded-[8px] px-3 text-sm text-muted hover:text-ink",
                  period === p && "bg-surface font-medium text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
                )}
              >
                {PERIOD_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Nenhuma entrega com entregador neste período.</p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <Card key={r.driver?.id ?? r.orders[0].driverId}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium">{r.driver?.name ?? "Entregador apagado"}</p>
                  <p className="num text-sm text-muted">
                    {r.orders.length} {r.orders.length === 1 ? "entrega" : "entregas"}
                  </p>
                </div>
                <dl className="mt-3 space-y-1 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt>A pagar para ele</dt>
                    <dd className="num font-semibold">{formatMoney(r.pay)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt>Dinheiro que ele traz</dt>
                    <dd className="num">{formatMoney(r.cash)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-[13px] leading-5 text-muted">
                  {r.orders.map((o) => formatOrderNumber(o.number)).join(", ")}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-[15px] font-semibold">Cadastro</h2>
        {drivers.length === 0 ? (
          <div className="mt-3 max-w-[560px] rounded-card border border-dashed border-control px-5 py-8 text-center">
            <p className="text-[15px] font-medium">Nenhum entregador ainda</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              Cadastre quem faz as entregas, com o WhatsApp, e diga quanto cada um ganha: a taxa de entrega do pedido ou um valor fixo.
            </p>
            {manage && (
              <Button variant="primary" className="mt-5" onClick={() => setEditing(newDriver(store.id))}>
                Cadastrar o primeiro
              </Button>
            )}
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-line rounded-card border border-line">
            {drivers.map((d) => (
              <li key={d.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-medium">{d.name}</span>
                    {!d.active && <Pill>Desativado</Pill>}
                  </div>
                  <p className="text-[13px] text-muted">
                    {d.phone ? formatPhone(d.phone) : "sem WhatsApp"} · {payLabel(d)}
                  </p>
                </div>
                {manage && (
                  <div className="flex items-center gap-1">
                    <Switch
                      checked={d.active}
                      label={`${d.name} ativo`}
                      onChange={(v) => void attempt(toast, () => saveDriver({ ...d, active: v }), v ? `${d.name} ativado` : `${d.name} desativado`)}
                    />
                    <Button variant="ghost" size="sm" className="size-9 px-0" aria-label={`Editar ${d.name}`} onClick={() => setEditing(d)}>
                      <Pencil className="size-4" strokeWidth={1.5} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-9 px-0 text-muted hover:text-negative"
                      aria-label={`Apagar ${d.name}`}
                      onClick={() => setRemoving(d)}
                    >
                      <Trash2 className="size-4" strokeWidth={1.5} />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <DriverModal driver={editing} isNew={!drivers.some((d) => d.id === editing.id)} onClose={() => setEditing(null)} />}

      {removing && (
        <Modal open title={`Apagar ${removing.name}?`} onClose={() => setRemoving(null)}>
          <p className="text-sm leading-6">
            As entregas que ele já fez ficam sem entregador e saem do acerto. Se ele só parou de trabalhar com vocês, desative em vez de apagar:
            o histórico continua.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setRemoving(null)}>Voltar</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const ok = await attempt(toast, async () => {
                  await deleteDriver(removing);
                  return true;
                }, "Entregador apagado");
                if (ok) setRemoving(null);
              }}
            >
              Apagar
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function DriverModal({ driver, isNew, onClose }: { driver: Driver; isNew: boolean; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(driver.name);
  const [phone, setPhone] = useState(driver.phone ? formatPhone(driver.phone) : "");
  const [payKind, setPayKind] = useState(driver.payKind);
  const [amount, setAmount] = useState(driver.payKind === "fixed" ? moneyInput(driver.payAmount) : "");
  const [active, setActive] = useState(driver.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payAmount = payKind === "fixed" ? parseMoney(amount) : 0;
    if (payAmount === null) return setError("Confira o valor por entrega.");
    setSaving(true);
    const saved = await attempt(toast, () => saveDriver({ ...driver, name, phone, payKind, payAmount, active }), isNew ? "Entregador cadastrado" : "Entregador salvo");
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <Modal open title={isNew ? "Novo entregador" : `Editar ${driver.name}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome">
          {(p) => <Input {...p} data-autofocus required maxLength={60} autoComplete="off" placeholder="Zé da moto" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="WhatsApp" hint="Com DDD. É para onde vai o pedido quando você manda pelo WhatsApp.">
          {(p) => <Input {...p} inputMode="tel" autoComplete="off" placeholder="(81) 91234-5678" value={phone} onChange={(e) => setPhone(formatPhone(e.target.value))} />}
        </Field>
        <div>
          <p className="text-sm font-medium">Quanto ganha por entrega</p>
          <div role="radiogroup" aria-label="Forma de pagamento do entregador" className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ["fee", "A taxa de entrega"],
                ["fixed", "Valor fixo"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={payKind === value}
                onClick={() => setPayKind(value)}
                className={cn(
                  "h-10 rounded-control border text-sm font-medium",
                  payKind === value ? "border-accent bg-accent-soft text-accent" : "border-control hover:bg-raised",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {payKind === "fee" ? (
            <p className="mt-2 text-[13px] text-muted">Ele fica com a taxa do bairro de cada pedido. Entrega grátis por cupom conta zero.</p>
          ) : (
            <label className="mt-3 flex items-center gap-2 text-sm">
              R$
              <Input inputMode="decimal" className="max-w-[120px]" placeholder="7,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              por entrega
            </label>
          )}
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Ativo</span>
            <span className="block text-xs text-muted">Desativado não aparece na hora de escolher.</span>
          </span>
          <Switch checked={active} onChange={setActive} label="Entregador ativo" />
        </div>
        {error && <p className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Voltar</Button>
          <Button type="submit" variant="primary" disabled={saving || !name.trim()}>
            {saving ? "Salvando…" : isNew ? "Cadastrar" : "Salvar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
