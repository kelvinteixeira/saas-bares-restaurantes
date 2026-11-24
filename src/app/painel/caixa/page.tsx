"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Printer } from "lucide-react";
import type { CashMovement, CashSession } from "@/lib/types";
import { PAYMENT_KINDS, PAYMENT_KIND_LABEL, openSession, orderDue, sessionSummary, tabDue } from "@/lib/domain/cash";
import { isOpenOrder } from "@/lib/domain/orders";
import { formatClock, formatMoney, formatOrderNumber, parseMoney } from "@/lib/format";
import { cashMovement, closeCash, openCash } from "@/lib/store/cash";
import { cn } from "@/lib/cn";
import { usePainel } from "@/components/painel/painel-context";
import { Card, PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { attempt, useToast } from "@/components/ui/toast";

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function CaixaPage() {
  const { db, store } = usePainel();
  const [reportId, setReportId] = useState<string | null>(null);
  const sessions = (db.cashSessions ?? []).filter((s) => s.storeId === store.id).sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  const current = openSession(sessions, store.id);
  const report = reportId ? sessions.find((s) => s.id === reportId) : undefined;

  if (report) return <Report session={report} onBack={() => setReportId(null)} />;

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      {current ? <OpenCash session={current} onClosed={setReportId} /> : <ClosedCash />}
      <History sessions={sessions.filter((s) => s.status === "closed")} onOpen={setReportId} />
    </div>
  );
}

// ---------- caixa fechado ----------

function ClosedCash() {
  const { store } = usePainel();
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const value = text.trim() ? parseMoney(text) : 0;

  return (
    <>
      <PageHeader title="Caixa" subtitle="Fechado. Abra o caixa para receber as contas das mesas e os pedidos." />
      <Card className="mt-6 max-w-[480px]">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (value === null) return;
            setBusy(true);
            await attempt(toast, () => openCash(store.id, value), "Caixa aberto");
            setBusy(false);
          }}
        >
          <label className="flex flex-col gap-2 text-sm font-medium">
            Fundo de troco (R$)
            <Input inputMode="decimal" placeholder="0,00" value={text} autoFocus onChange={(e) => setText(e.target.value)} aria-invalid={value === null ? true : undefined} />
            <span className="text-xs font-normal text-muted">O dinheiro que já está na gaveta para dar troco. Pode ser zero.</span>
          </label>
          <Button type="submit" variant="primary" size="lg" disabled={busy || value === null}>
            {busy ? "Abrindo…" : `Abrir caixa${value ? ` com ${formatMoney(value)}` : ""}`}
          </Button>
        </form>
      </Card>
    </>
  );
}

// ---------- caixa aberto ----------

function OpenCash({ session, onClosed }: { session: CashSession; onClosed: (id: string) => void }) {
  const { db, store } = usePainel();
  const [moving, setMoving] = useState<CashMovement["kind"] | null>(null);
  const [closing, setClosing] = useState(false);
  const payments = db.payments ?? [];
  const movements = db.cashMovements ?? [];
  const summary = sessionSummary(session, payments, movements);

  // O que ainda está para receber: mesas abertas e pedidos fora de mesa de hoje.
  const today = new Date(session.openedAt).toDateString();
  const openTabs = (db.tabs ?? [])
    .filter((t) => t.storeId === store.id && t.status !== "closed")
    .map((t) => ({ tab: t, due: tabDue(t, db.orders, payments) }))
    .filter((x) => x.due > 0)
    .sort((a, b) => a.tab.tableNumber - b.tab.tableNumber);
  const openOrders = db.orders
    .filter((o) => o.storeId === store.id && !o.tabId && (isOpenOrder(o) || new Date(o.createdAt).toDateString() === today))
    .map((o) => ({ order: o, due: orderDue(o, payments) }))
    .filter((x) => x.due > 0)
    .sort((a, b) => a.order.number - b.order.number);

  type Line = { id: string; at: string; label: string; detail: string; amount: number; sign: 1 | -1 | 0 };
  const lines: Line[] = [
    ...payments
      .filter((p) => p.cashSessionId === session.id)
      .map((p): Line => {
        const tab = p.tabId ? (db.tabs ?? []).find((t) => t.id === p.tabId) : undefined;
        const order = p.orderId ? db.orders.find((o) => o.id === p.orderId) : undefined;
        return {
          id: p.id,
          at: p.createdAt,
          label: tab ? `Mesa ${tab.tableNumber}` : order ? `Pedido ${formatOrderNumber(order.number)}` : "Recebimento",
          detail: PAYMENT_KIND_LABEL[p.method] + (p.changeGiven ? ` · troco ${formatMoney(p.changeGiven)}` : ""),
          amount: p.amount,
          sign: 1,
        };
      }),
    ...movements
      .filter((m) => m.cashSessionId === session.id)
      .map((m): Line => ({
        id: m.id,
        at: m.createdAt,
        label: m.kind === "withdrawal" ? "Sangria" : "Suprimento",
        detail: m.reason,
        amount: m.amount,
        sign: m.kind === "withdrawal" ? -1 : 1,
      })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <PageHeader
        title="Caixa"
        subtitle={`Aberto às ${formatClock(new Date(session.openedAt))} com ${formatMoney(session.openingAmount)} de fundo · ${summary.count} ${summary.count === 1 ? "recebimento" : "recebimentos"}`}
        actions={
          <>
            <Button onClick={() => setMoving("deposit")}>
              <ArrowDownToLine className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Suprimento
            </Button>
            <Button onClick={() => setMoving("withdrawal")}>
              <ArrowUpFromLine className="size-4" strokeWidth={1.5} aria-hidden="true" />
              Sangria
            </Button>
            <Button variant="primary" onClick={() => setClosing(true)}>
              Fechar caixa
            </Button>
          </>
        }
      />

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {PAYMENT_KINDS.map((k) => (
          <div key={k} className="rounded-card border border-line p-4">
            <p className="text-sm text-muted">{PAYMENT_KIND_LABEL[k]}</p>
            <p className="num mt-1 text-[22px] font-semibold">{formatMoney(summary.byMethod[k])}</p>
          </div>
        ))}
        <div className="rounded-card border border-line bg-raised p-4">
          <p className="text-sm text-muted">Total recebido</p>
          <p className="num mt-1 text-[22px] font-semibold">{formatMoney(summary.received)}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card title="Movimento do turno" bodyClassName={lines.length ? "px-0 pb-1" : undefined}>
          {lines.length === 0 ? (
            <p className="text-sm text-muted">Nada recebido ainda. Os recebimentos das mesas e dos pedidos aparecem aqui.</p>
          ) : (
            <ul className="divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="flex items-baseline gap-3 px-5 py-2.5 text-sm">
                  <span className="num w-11 flex-none text-muted">{formatClock(new Date(l.at))}</span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{l.label}</span> <span className="text-muted">· {l.detail}</span>
                  </span>
                  <span className={cn("num", l.sign < 0 && "text-negative")}>
                    {l.sign < 0 ? "−" : ""}
                    {formatMoney(l.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card title="Dinheiro na gaveta">
            <dl className="flex flex-col gap-1.5 text-sm">
              <Row label="Fundo de troco" value={session.openingAmount} />
              <Row label="Recebido em dinheiro" value={summary.byMethod.cash} />
              {summary.deposits > 0 && <Row label="Suprimentos" value={summary.deposits} />}
              {summary.withdrawals > 0 && <Row label="Sangrias" value={-summary.withdrawals} />}
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2.5">
                <dt className="font-semibold">Deve ter na gaveta</dt>
                <dd className="num text-[22px] font-semibold">{formatMoney(summary.expectedCash)}</dd>
              </div>
            </dl>
          </Card>

          <Card title="Para receber" aside={openTabs.length + openOrders.length ? `${openTabs.length + openOrders.length}` : undefined}>
            {openTabs.length + openOrders.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma conta aberta.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {openTabs.map(({ tab, due }) => (
                  <li key={tab.id}>
                    <Link href={`/painel/mesas/${tab.tableNumber}`} className="flex justify-between rounded-[8px] px-2 py-1.5 hover:bg-raised">
                      <span>
                        Mesa {tab.tableNumber}
                        {tab.status === "bill_requested" && <span className="text-pill-warning-ink"> · pediu a conta</span>}
                      </span>
                      <span className="num">{formatMoney(due)}</span>
                    </Link>
                  </li>
                ))}
                {openOrders.map(({ order, due }) => (
                  <li key={order.id}>
                    <Link href={`/painel/pedidos?pedido=${order.id}`} className="flex justify-between rounded-[8px] px-2 py-1.5 hover:bg-raised">
                      <span>
                        Pedido {formatOrderNumber(order.number)} <span className="text-muted">· {order.customer.name}</span>
                      </span>
                      <span className="num">{formatMoney(due)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {moving && <MovementModal kind={moving} expected={summary.expectedCash} onClose={() => setMoving(null)} />}
      {closing && (
        <CloseModal
          session={session}
          expected={summary.expectedCash}
          openCount={openTabs.length + openOrders.length}
          onClose={() => setClosing(false)}
          onClosed={(id) => {
            setClosing(false);
            onClosed(id);
          }}
        />
      )}
    </>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted">{label}</dt>
      <dd className="num">
        {value < 0 ? "−" : ""}
        {formatMoney(Math.abs(value))}
      </dd>
    </div>
  );
}

function MovementModal({ kind, expected, onClose }: { kind: CashMovement["kind"]; expected: number; onClose: () => void }) {
  const { store } = usePainel();
  const toast = useToast();
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const value = text.trim() ? parseMoney(text) : null;
  const withdrawal = kind === "withdrawal";

  return (
    <Modal open title={withdrawal ? "Sangria" : "Suprimento"} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!value) return;
          setBusy(true);
          const ok = await attempt(toast, async () => {
            await cashMovement(store.id, kind, value, reason);
            return true;
          }, withdrawal ? "Sangria registrada" : "Suprimento registrado");
          setBusy(false);
          if (ok) onClose();
        }}
      >
        <p className="text-sm leading-6 text-muted">
          {withdrawal
            ? `Dinheiro que sai da gaveta (para o cofre, o banco, um pagamento). Há ${formatMoney(expected)} na gaveta.`
            : "Dinheiro que entra na gaveta sem ser venda, por exemplo mais troco."}
        </p>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Valor (R$)
          <Input inputMode="decimal" data-autofocus value={text} onChange={(e) => setText(e.target.value)} placeholder="0,00" />
        </label>
        <label className="flex flex-col gap-2 text-sm font-medium">
          Motivo
          <Input value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} placeholder={withdrawal ? "Ex.: depósito no banco" : "Ex.: troco extra"} />
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Voltar</Button>
          <Button type="submit" variant="primary" disabled={busy || !value || !reason.trim()}>
            {busy ? "Registrando…" : `Registrar ${value ? formatMoney(value) : ""}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CloseModal({
  session,
  expected,
  openCount,
  onClose,
  onClosed,
}: {
  session: CashSession;
  expected: number;
  openCount: number;
  onClose: () => void;
  onClosed: (id: string) => void;
}) {
  const { store } = usePainel();
  const toast = useToast();
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const counted = text.trim() ? parseMoney(text) : null;
  const diff = counted === null ? null : counted - expected;

  return (
    <Modal open title="Fechar o caixa" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (counted === null) return;
          setBusy(true);
          const closed = await attempt(toast, () => closeCash(store.id, counted, notes), "Caixa fechado");
          setBusy(false);
          if (closed) onClosed(session.id);
        }}
      >
        {openCount > 0 && (
          <p className="rounded-[10px] bg-pill-warning-bg px-3 py-2 text-[13px] leading-5 text-pill-warning-ink">
            {openCount === 1 ? "Ainda há 1 conta" : `Ainda há ${openCount} contas`} para receber. Dá para fechar assim mesmo; elas
            ficam para o próximo turno.
          </p>
        )}
        <label className="flex flex-col gap-2 text-sm font-medium">
          Quanto há em dinheiro na gaveta? (R$)
          <Input inputMode="decimal" data-autofocus value={text} placeholder="0,00" onChange={(e) => setText(e.target.value)} />
          <span className="text-xs font-normal text-muted">Conte as notas e moedas, sem olhar o esperado.</span>
        </label>
        {diff !== null && (
          <dl className="flex flex-col gap-1.5 rounded-[10px] bg-raised px-3 py-2.5 text-sm">
            <Row label="Esperado" value={expected} />
            <Row label="Contado" value={counted!} />
            <div className="flex justify-between font-semibold">
              <dt>{diff === 0 ? "Bateu certinho" : diff > 0 ? "Sobrou" : "Faltou"}</dt>
              <dd className={cn("num", diff < 0 && "text-negative", diff > 0 && "text-positive")}>{formatMoney(Math.abs(diff))}</dd>
            </div>
          </dl>
        )}
        <label className="flex flex-col gap-2 text-sm font-medium">
          Observação <span className="sr-only">(opcional)</span>
          <Textarea maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: faltou moeda de troco" />
        </label>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Voltar</Button>
          <Button type="submit" variant="primary" disabled={busy || counted === null}>
            {busy ? "Fechando…" : "Fechar caixa"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- histórico e relatório ----------

function History({ sessions, onOpen }: { sessions: CashSession[]; onOpen: (id: string) => void }) {
  if (!sessions.length) return null;
  return (
    <Card title="Turnos anteriores" className="mt-6" bodyClassName="px-0 pb-1">
      <ul className="divide-y divide-line">
        {sessions.map((s) => {
          const diff = (s.countedAmount ?? 0) - (s.expectedAmount ?? 0);
          return (
            <li key={s.id}>
              <button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left text-sm hover:bg-raised">
                <span className="num flex-1">
                  {dateTime(s.openedAt)} → {s.closedAt ? formatClock(new Date(s.closedAt)) : ""}
                </span>
                <span className={cn("num", diff < 0 && "text-negative", diff > 0 && "text-positive")}>
                  {diff === 0 ? "bateu" : `${diff > 0 ? "sobrou" : "faltou"} ${formatMoney(Math.abs(diff))}`}
                </span>
                <span className="font-medium text-accent">Ver relatório</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function Report({ session, onBack }: { session: CashSession; onBack: () => void }) {
  const { db, store } = usePainel();
  const summary = sessionSummary(session, db.payments ?? [], db.cashMovements ?? []);
  const moves = (db.cashMovements ?? []).filter((m) => m.cashSessionId === session.id);
  const expected = session.expectedAmount ?? summary.expectedCash;
  const counted = session.countedAmount ?? 0;
  const diff = counted - expected;

  return (
    <div className="px-4 py-5 sm:px-6 sm:py-6">
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <Button onClick={onBack}>
          <ArrowLeft className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Voltar ao caixa
        </Button>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer className="size-4" strokeWidth={1.5} aria-hidden="true" />
          Imprimir
        </Button>
      </div>
      <article className="max-w-[520px] rounded-card border border-line p-5 print:border-0 print:p-0">
        <p className="text-xs text-muted">{store.name}</p>
        <h1 className="text-[20px] font-semibold">Fechamento de caixa</h1>
        <p className="num mt-1 text-sm text-muted">
          {dateTime(session.openedAt)} até {session.closedAt ? dateTime(session.closedAt) : "agora"}
        </p>
        <dl className="mt-4 flex flex-col gap-1.5 text-sm">
          <p className="text-xs font-medium tracking-[0.06em] text-muted uppercase">Recebido ({summary.count})</p>
          {PAYMENT_KINDS.map((k) => (
            <Row key={k} label={PAYMENT_KIND_LABEL[k]} value={summary.byMethod[k]} />
          ))}
          <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
            <dt>Total recebido</dt>
            <dd className="num">{formatMoney(summary.received)}</dd>
          </div>
          {summary.changeGiven > 0 && <Row label="Troco dado (já descontado)" value={summary.changeGiven} />}

          <p className="mt-3 text-xs font-medium tracking-[0.06em] text-muted uppercase">Dinheiro</p>
          <Row label="Fundo de troco" value={session.openingAmount} />
          <Row label="Recebido em dinheiro" value={summary.byMethod.cash} />
          {moves.map((m) => (
            <Row key={m.id} label={`${m.kind === "withdrawal" ? "Sangria" : "Suprimento"}: ${m.reason}`} value={m.kind === "withdrawal" ? -m.amount : m.amount} />
          ))}
          <div className="flex justify-between border-t border-line pt-1.5">
            <dt className="font-medium">Esperado na gaveta</dt>
            <dd className="num font-medium">{formatMoney(expected)}</dd>
          </div>
          <Row label="Contado" value={counted} />
          <div className="flex justify-between text-[15px] font-semibold">
            <dt>{diff === 0 ? "Diferença" : diff > 0 ? "Sobrou" : "Faltou"}</dt>
            <dd className={cn("num", diff < 0 && "text-negative", diff > 0 && "text-positive")}>{formatMoney(Math.abs(diff))}</dd>
          </div>
        </dl>
        {session.notes && <p className="mt-4 rounded-[10px] bg-raised px-3 py-2 text-sm">Observação: {session.notes}</p>}
      </article>
    </div>
  );
}
