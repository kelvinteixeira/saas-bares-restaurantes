"use client";

import { useState } from "react";
import { FileText } from "lucide-react";
import type { Order } from "@/lib/types";
import { canCancelNfce, formatAccessKey, formatCpf, orderDocument, validCancelReason, validCpf } from "@/lib/domain/fiscal";
import { cancelNfce, emitNfce } from "@/lib/store/fiscal";
import { formatClock, onlyDigits } from "@/lib/format";
import { usePainel } from "@/components/painel/painel-context";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Pill } from "@/components/ui/pill";
import { attempt, useToast } from "@/components/ui/toast";

const STATUS = {
  processing: { label: "Enviando", tone: "warning" },
  authorized: { label: "Autorizada", tone: "positive" },
  rejected: { label: "Rejeitada", tone: "negative" },
  error: { label: "Erro no envio", tone: "negative" },
  cancelled: { label: "Cancelada", tone: "neutral" },
} as const;

/** NFC-e do pedido (balcão, retirada e entrega). Só para quem mexe no caixa e com a emissão ligada. */
export function OrderNfce({ order }: { order: Order }) {
  const { db, store, role, now } = usePainel();
  const toast = useToast();
  const [cpf, setCpf] = useState("");
  const [askCpf, setAskCpf] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const fiscal = (db.storeFiscal ?? []).find((f) => f.storeId === store.id);
  const doc = orderDocument(db.fiscalDocs ?? [], order.id);
  if (role !== "owner" && role !== "manager" && role !== "cashier") return null;
  if (order.tabId || order.mode === "table") return null;
  if (!doc && (!fiscal?.enabled || order.status === "cancelado")) return null;

  const active = doc && (doc.status === "authorized" || doc.status === "processing");
  const cpfDigits = onlyDigits(cpf);
  const cpfOk = !cpfDigits || validCpf(cpfDigits);

  async function emit() {
    setBusy(true);
    const result = await attempt(toast, () => emitNfce(order.id, cpfDigits || undefined));
    setBusy(false);
    if (result) {
      toast(result.status === "authorized" ? `NFC-e ${result.number} autorizada` : `NFC-e ${STATUS[result.status].label.toLowerCase()}`, result.status === "authorized" ? undefined : "negative");
      setAskCpf(false);
      setCpf("");
    }
  }

  return (
    <div className="no-print mt-3 rounded-card border border-line p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          <FileText className="size-4 text-muted" strokeWidth={1.5} aria-hidden="true" />
          Nota fiscal
        </span>
        {doc && <Pill tone={STATUS[doc.status].tone}>{STATUS[doc.status].label}</Pill>}
      </div>

      {doc && (
        <div className="mt-2 text-[13px] leading-5">
          {doc.provider === "simulador" && (
            <p className="mb-1.5 rounded-control bg-pill-warning-bg px-2 py-1 text-pill-warning-ink">Simulada: sem valor fiscal.</p>
          )}
          {doc.number && (
            <p>
              NFC-e nº {doc.number} · série {doc.series} · {doc.environment === "producao" ? "produção" : "homologação"} · {formatClock(new Date(doc.createdAt))}
              {doc.cpf ? ` · CPF ${formatCpf(doc.cpf)}` : ""}
            </p>
          )}
          {doc.accessKey && <p className="num break-all font-mono text-[12px] text-muted">{formatAccessKey(doc.accessKey)}</p>}
          {doc.message && doc.provider !== "simulador" && <p className="text-muted">{doc.message}</p>}
          {doc.status === "cancelled" && doc.message && <p className="text-muted">{doc.message}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {doc.danfeUrl && (
              <a href={doc.danfeUrl} target="_blank" rel="noreferrer" className="font-medium text-accent hover:underline">
                Abrir DANFE
              </a>
            )}
            {canCancelNfce(doc, now) && (
              <button type="button" onClick={() => setCancelling(true)} className="font-medium text-negative hover:underline">
                Cancelar nota
              </button>
            )}
          </div>
        </div>
      )}

      {!active && fiscal?.enabled && order.status !== "cancelado" && (
        <div className="mt-2">
          {askCpf && (
            <label className="mb-2 flex flex-col gap-1 text-[13px]">
              CPF na nota
              <Input
                inputMode="numeric"
                placeholder="000.000.000-00"
                value={cpf}
                aria-invalid={!cpfOk}
                onChange={(e) => {
                  const d = onlyDigits(e.target.value).slice(0, 11);
                  setCpf(d.length === 11 ? formatCpf(d) : d);
                }}
              />
              {!cpfOk && <span className="text-negative">Confira o CPF.</span>}
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" disabled={busy || !cpfOk} onClick={() => void emit()}>
              {busy ? "Emitindo…" : doc ? "Emitir de novo" : "Emitir NFC-e"}
            </Button>
            {!askCpf && (
              <button type="button" onClick={() => setAskCpf(true)} className="text-[13px] font-medium text-accent hover:underline">
                CPF na nota?
              </button>
            )}
          </div>
        </div>
      )}

      {cancelling && doc && (
        <Modal open title={`Cancelar a NFC-e nº ${doc.number}?`} onClose={() => setCancelling(false)}>
          <p className="text-sm leading-6">A SEFAZ pede o motivo. Depois de cancelada, dá para emitir outra nota para este pedido.</p>
          <Textarea className="mt-3" rows={3} maxLength={255} placeholder="Ex.: cliente desistiu do pedido" value={reason} onChange={(e) => setReason(e.target.value)} />
          <p className="mt-1 text-xs text-muted">{reason.trim().length}/15 letras no mínimo</p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setCancelling(false)}>Voltar</Button>
            <Button
              variant="danger"
              disabled={!validCancelReason(reason)}
              onClick={async () => {
                const ok = await attempt(toast, () => cancelNfce(doc, reason), "NFC-e cancelada");
                if (ok) {
                  setCancelling(false);
                  setReason("");
                }
              }}
            >
              Cancelar nota
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
