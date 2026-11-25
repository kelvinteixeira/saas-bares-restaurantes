import type { FiscalDocument } from "@/lib/types";
import type { NfcePayload } from "@/lib/domain/fiscal";

// Interface do emissor fiscal. Cada emissor (Focus NFe, Nuvem Fiscal, PlugNotas...) é um arquivo
// que traduz a NfcePayload para a API dele. Enquanto nenhum foi escolhido, vale o simulador.

export interface EmitContext {
  /** Cadastro da loja no emissor (conta da Comanda como software house). */
  companyId?: string;
  /** Próximo número e série, para emissores em que a numeração fica do nosso lado. */
  number: number;
  series: number;
}

export interface EmitResult {
  status: "authorized" | "rejected" | "processing" | "error";
  number?: number;
  series?: number;
  accessKey?: string;
  protocol?: string;
  danfeUrl?: string;
  xmlUrl?: string;
  message?: string;
  providerRef?: string;
}

export interface FiscalProvider {
  /** Gravado em cada nota. "simulador" = sem valor fiscal. */
  name: string;
  /** Pode emitir em produção (o simulador não pode). */
  production: boolean;
  emit(payload: NfcePayload, ctx: EmitContext): Promise<EmitResult>;
  cancel(doc: FiscalDocument, reason: string, ctx: { companyId?: string }): Promise<{ ok: boolean; protocol?: string; message?: string }>;
}
