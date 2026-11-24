"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Coupon, CouponKind } from "@/lib/types";
import { couponLabel, couponStatus, couponUses, type CouponStatus } from "@/lib/domain/coupons";
import { formatMoney, moneyInput, parseMoney } from "@/lib/format";
import { deleteCoupon, newCoupon, saveCoupon } from "@/lib/store/coupons";
import { cn } from "@/lib/cn";
import { usePainel } from "@/components/painel/painel-context";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Field, Input, Switch } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { attempt, useToast } from "@/components/ui/toast";

const STATUS: Record<CouponStatus, { label: string; tone: "positive" | "neutral" | "warning" | "negative" }> = {
  active: { label: "Valendo", tone: "positive" },
  scheduled: { label: "Agendado", tone: "warning" },
  expired: { label: "Venceu", tone: "neutral" },
  exhausted: { label: "Esgotou", tone: "neutral" },
  off: { label: "Desligado", tone: "neutral" },
};

const KINDS: { value: CouponKind; label: string }[] = [
  { value: "percent", label: "Porcentagem" },
  { value: "fixed", label: "Valor fixo" },
  { value: "free_delivery", label: "Entrega grátis" },
];

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Condições em uma linha: "a partir de R$ 50 · até 30/11 · 1 por cliente · 100 usos". */
function conditions(c: Coupon): string {
  const parts: string[] = [];
  if (c.minOrder) parts.push(`a partir de ${formatMoney(c.minOrder)}`);
  if (c.startsAt) parts.push(`desde ${shortDate(c.startsAt)}`);
  if (c.endsAt) parts.push(`até ${shortDate(new Date(new Date(c.endsAt).getTime() - 1).toISOString())}`);
  if (c.oncePerCustomer) parts.push("1 por cliente");
  if (c.maxUses) parts.push(`até ${c.maxUses} usos`);
  return parts.join(" · ") || "sem condições";
}

export default function CuponsPage() {
  const { db, store, now } = usePainel();
  const toast = useToast();
  const [editing, setEditing] = useState<Coupon | null>(null);
  const [removing, setRemoving] = useState<Coupon | null>(null);
  const coupons = (db.coupons ?? []).filter((c) => c.storeId === store.id);
  const orders = db.orders.filter((o) => o.storeId === store.id);

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <PageHeader
        title="Cupons"
        subtitle="O cliente digita o código no fechamento do pedido e o desconto sai na hora."
        actions={
          <Button variant="primary" onClick={() => setEditing(newCoupon(store.id))}>
            <Plus className="size-4" strokeWidth={2} aria-hidden="true" />
            Novo cupom
          </Button>
        }
      />

      {coupons.length === 0 ? (
        <div className="mt-6 max-w-[560px] rounded-card border border-dashed border-control px-5 py-8 text-center">
          <p className="text-[15px] font-medium">Nenhum cupom ainda</p>
          <p className="mt-1 text-sm leading-6 text-muted">
            Ideias: <strong>PRIMEIRA</strong> com 10% para quem pede pela primeira vez, <strong>FRETEGRATIS</strong> acima de R$ 80, ou um código
            para divulgar no Instagram.
          </p>
          <Button variant="primary" className="mt-5" onClick={() => setEditing(newCoupon(store.id))}>
            Criar o primeiro cupom
          </Button>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-card border border-line">
          {coupons.map((c) => {
            const status = couponStatus(c, orders, now);
            const uses = couponUses(c, orders);
            const given = uses.reduce((s, o) => s + (o.discount ?? 0), 0);
            return (
              <li key={c.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[15px] font-semibold tracking-wide">{c.code}</span>
                    <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>
                  </div>
                  <p className="mt-0.5 text-sm">{couponLabel(c)}</p>
                  <p className="text-[13px] text-muted">{conditions(c)}</p>
                </div>
                <div className="text-sm sm:w-[180px] sm:text-right">
                  <p className="num">
                    {uses.length} {uses.length === 1 ? "uso" : "usos"}
                    {c.maxUses ? ` de ${c.maxUses}` : ""}
                  </p>
                  {given > 0 && <p className="num text-[13px] text-muted">{formatMoney(given)} em desconto</p>}
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={c.active}
                    label={`Cupom ${c.code} ligado`}
                    onChange={(v) => void attempt(toast, () => saveCoupon({ ...c, active: v }), v ? `${c.code} ligado` : `${c.code} desligado`)}
                  />
                  <Button variant="ghost" size="sm" className="size-9 px-0" aria-label={`Editar ${c.code}`} onClick={() => setEditing(c)}>
                    <Pencil className="size-4" strokeWidth={1.5} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-9 px-0 text-muted hover:text-negative"
                    aria-label={`Apagar ${c.code}`}
                    onClick={() => setRemoving(c)}
                  >
                    <Trash2 className="size-4" strokeWidth={1.5} />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editing && <CouponModal coupon={editing} isNew={!coupons.some((c) => c.id === editing.id)} onClose={() => setEditing(null)} />}

      {removing && (
        <Modal open title={`Apagar o cupom ${removing.code}?`} onClose={() => setRemoving(null)}>
          <p className="text-sm leading-6">
            O código para de funcionar na hora. Os pedidos que já usaram continuam com o desconto. Se quiser só pausar, desligue o cupom em vez
            de apagar.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setRemoving(null)}>Voltar</Button>
            <Button
              variant="danger"
              onClick={async () => {
                const ok = await attempt(toast, async () => {
                  await deleteCoupon(removing);
                  return true;
                }, "Cupom apagado");
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

// Datas do formulário: "AAAA-MM-DD" no horário do aparelho. O fim vale até o final daquele dia.
const toDateInput = (iso?: string, end = false) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() - (end ? 1 : 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fromDateInput = (value: string, end = false) => {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d + (end ? 1 : 0)).toISOString();
};

function CouponModal({ coupon, isNew, onClose }: { coupon: Coupon; isNew: boolean; onClose: () => void }) {
  const toast = useToast();
  const [code, setCode] = useState(coupon.code);
  const [kind, setKind] = useState<CouponKind>(coupon.kind);
  const [percent, setPercent] = useState(coupon.kind === "percent" ? String(coupon.value) : "10");
  const [fixed, setFixed] = useState(coupon.kind === "fixed" ? moneyInput(coupon.value) : "");
  const [minOrder, setMinOrder] = useState(coupon.minOrder ? moneyInput(coupon.minOrder) : "");
  const [maxUses, setMaxUses] = useState(coupon.maxUses ? String(coupon.maxUses) : "");
  const [once, setOnce] = useState(coupon.oncePerCustomer);
  const [starts, setStarts] = useState(toDateInput(coupon.startsAt));
  const [ends, setEnds] = useState(toDateInput(coupon.endsAt, true));
  const [active, setActive] = useState(coupon.active);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const value = kind === "percent" ? Number(percent) : kind === "fixed" ? parseMoney(fixed) : 0;
    const min = minOrder.trim() ? parseMoney(minOrder) : 0;
    if (value === null || Number.isNaN(value)) return setError("Confira o valor do desconto.");
    if (min === null) return setError("Confira o pedido mínimo.");
    setSaving(true);
    const saved = await attempt(toast, () =>
      saveCoupon({
        ...coupon,
        code,
        kind,
        value,
        minOrder: min,
        maxUses: maxUses.trim() ? Number(maxUses) : undefined,
        oncePerCustomer: once,
        startsAt: fromDateInput(starts),
        endsAt: fromDateInput(ends, true),
        active,
      }),
      isNew ? "Cupom criado" : "Cupom salvo",
    );
    setSaving(false);
    if (saved) onClose();
  }

  return (
    <Modal open title={isNew ? "Novo cupom" : `Editar ${coupon.code}`} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Código" hint="O que o cliente digita. Letras e números, sem espaço.">
          {(p) => (
            <Input
              {...p}
              data-autofocus
              required
              maxLength={20}
              autoComplete="off"
              className="font-mono uppercase"
              placeholder="PRIMEIRA"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            />
          )}
        </Field>

        <div>
          <p className="text-sm font-medium">Desconto</p>
          <div role="radiogroup" aria-label="Tipo de desconto" className="mt-2 grid grid-cols-3 gap-2">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                onClick={() => setKind(k.value)}
                className={cn(
                  "h-10 rounded-control border text-sm font-medium",
                  kind === k.value ? "border-accent bg-accent-soft text-accent" : "border-control hover:bg-raised",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          {kind === "percent" && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <Input inputMode="numeric" className="max-w-[90px]" value={percent} onChange={(e) => setPercent(e.target.value.replace(/\D/g, "").slice(0, 3))} />
              % dos itens
            </label>
          )}
          {kind === "fixed" && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              R$
              <Input inputMode="decimal" className="max-w-[120px]" placeholder="10,00" value={fixed} onChange={(e) => setFixed(e.target.value)} />
              de desconto nos itens
            </label>
          )}
          {kind === "free_delivery" && <p className="mt-2 text-[13px] text-muted">Zera a taxa de entrega do bairro. Não vale para retirada nem mesa.</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Pedido mínimo (R$)" hint="Sobre os itens. Vazio = sem mínimo.">
            {(p) => <Input {...p} inputMode="decimal" placeholder="0,00" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} />}
          </Field>
          <Field label="Limite de usos" hint="Vazio = sem limite.">
            {(p) => <Input {...p} inputMode="numeric" placeholder="100" value={maxUses} onChange={(e) => setMaxUses(e.target.value.replace(/\D/g, "").slice(0, 6))} />}
          </Field>
          <Field label="Começa em" hint="Vazio = já vale.">
            {(p) => <Input {...p} type="date" value={starts} onChange={(e) => setStarts(e.target.value)} />}
          </Field>
          <Field label="Vale até" hint="Inclui o dia todo.">
            {(p) => <Input {...p} type="date" value={ends} onChange={(e) => setEnds(e.target.value)} />}
          </Field>
        </div>

        <div className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">Uma vez por cliente</span>
            <span className="block text-xs text-muted">Pelo WhatsApp do pedido.</span>
          </span>
          <Switch checked={once} onChange={setOnce} label="Uma vez por cliente" />
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium">Cupom ligado</span>
          <Switch checked={active} onChange={setActive} label="Cupom ligado" />
        </div>

        {error && <p className="text-sm text-negative">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Voltar</Button>
          <Button type="submit" variant="primary" disabled={saving || code.length < 3}>
            {saving ? "Salvando…" : isNew ? "Criar cupom" : "Salvar"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
