import { accessKey } from "@/lib/domain/fiscal";
import type { FiscalProvider } from "@/lib/fiscal/provider";

// Simulador: faz tudo o que um emissor faria (número, chave de acesso válida, protocolo), mas sem
// falar com a SEFAZ. A nota não tem valor fiscal e o servidor recusa usá-lo em produção.

export const SIMULATOR_NAME = "simulador";

export const simulator: FiscalProvider = {
  name: SIMULATOR_NAME,
  production: false,
  async emit(payload, ctx) {
    const issuedAt = new Date(payload.issuedAt);
    const code = Number(String(issuedAt.getTime()).slice(-8));
    return {
      status: "authorized",
      number: ctx.number,
      series: ctx.series,
      accessKey: accessKey({ state: payload.emitter.state, issuedAt, cnpj: payload.emitter.cnpj, series: ctx.series, number: ctx.number, code }),
      protocol: `9${String(issuedAt.getTime()).slice(-14)}`,
      message: "Nota simulada: sem valor fiscal.",
    };
  },
  async cancel() {
    return { ok: true, protocol: `9${String(Date.now()).slice(-14)}`, message: "Cancelamento simulado." };
  },
};
