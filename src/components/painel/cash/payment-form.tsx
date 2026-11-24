"use client";

import { useState } from "react";
import Link from "next/link";
import type { Payment, PaymentKind } from "@/lib/types";
import { PAYMENT_KINDS, PAYMENT_KIND_LABEL, cashSplit } from "@/lib/domain/cash";
import { formatClock, formatMoney, moneyInput, parseMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";

export interface PayInput {
  method: PaymentKind;
  amount?: number;
  received?: number;
}

/**
 * Formulário de recebimento: forma, valor (ou valor entregue, no dinheiro) e o troco.
 * O valor começa com o que falta; dá para receber uma parte e o resto em outra forma.
 */
export function PaymentForm({ due, onPay }: { due: number; onPay: (input: PayInput) => Promise<boolean> }) {
  const [method, setMethod] = useState<PaymentKind | null>(null);
  const [text, setText] = useState(moneyInput(due));
  const [busy, setBusy] = useState(false);
  const value = text.trim() ? parseMoney(text) : null;
  const cash = method === "cash";
  const split = cash && value ? cashSplit(due, value) : null;
  const invalid = value === null || value <= 0 || (!cash && value > due);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!method || invalid || value === null) return;
    setBusy(true);
    const ok = await onPay(cash ? { method, received: value } : { method, amount: value });
    setBusy(false);
    if (ok) {
      setMethod(null);
      setText("");
    }
  }

  const applied = cash ? (split?.amount ?? 0) : (value ?? 0);
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Forma de pagamento" className="grid grid-cols-4 gap-2">
        {PAYMENT_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={method === k}
            onClick={() => {
              setMethod(k);
              if (!text.trim()) setText(moneyInput(due));
            }}
            className={cn(
              "h-10 rounded-control border text-sm font-medium",
              method === k ? "border-accent bg-accent-soft text-accent" : "border-control hover:bg-raised",
            )}
          >
            {PAYMENT_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {method && (
        <label className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="w-full font-medium sm:w-auto">{cash ? "Valor entregue R$" : "Valor R$"}</span>
          <Input
            inputMode="decimal"
            className="max-w-[160px]"
            value={text}
            autoFocus
            aria-invalid={text.trim() !== "" && invalid ? true : undefined}
            onChange={(e) => setText(e.target.value)}
          />
          {cash && split && (
            <span className="num text-muted">
              {split.change > 0 ? `troco ${formatMoney(split.change)}` : due - split.amount > 0 ? `fica faltando ${formatMoney(due - split.amount)}` : "sem troco"}
            </span>
          )}
          {!cash && value !== null && value < due && value > 0 && (
            <span className="num text-muted">fica faltando {formatMoney(due - value)}</span>
          )}
          {!cash && value !== null && value > due && <span className="text-negative">passa do que falta</span>}
        </label>
      )}
      <Button type="submit" variant="primary" size="lg" disabled={!method || invalid || busy}>
        {busy ? "Registrando…" : !method ? "Escolha a forma de pagamento" : `Receber ${formatMoney(applied)}`}
      </Button>
    </form>
  );
}

/** Lista dos recebimentos de uma conta. */
export function PaymentList({ payments }: { payments: Payment[] }) {
  if (!payments.length) return null;
  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {payments.map((p) => (
        <li key={p.id} className="flex items-baseline justify-between gap-3">
          <span className="text-muted">
            <span className="num">{formatClock(new Date(p.createdAt))}</span> · {PAYMENT_KIND_LABEL[p.method]}
            {p.changeGiven > 0 && <span className="num"> · troco {formatMoney(p.changeGiven)}</span>}
          </span>
          <span className="num">{formatMoney(p.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Aviso de caixa fechado, com o atalho para abrir. */
export function CashClosedNotice() {
  return (
    <p className="rounded-[10px] bg-pill-warning-bg px-3 py-2.5 text-sm leading-5 text-pill-warning-ink">
      O caixa está fechado. Para receber,{" "}
      <Link href="/painel/caixa" className="font-medium underline">
        abra o caixa
      </Link>{" "}
      com o fundo de troco.
    </p>
  );
}
