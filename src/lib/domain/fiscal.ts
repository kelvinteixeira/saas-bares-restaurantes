import type { FiscalDocument, FiscalEnvironment, Order, Payment, Product, Store, StoreFiscal, TaxRegime } from "@/lib/types";
import { onlyDigits } from "@/lib/format";

// NFC-e (modelo 65). Aqui ficam as regras que não dependem do emissor fiscal: conferir os dados,
// montar a nota (itens, desconto rateado, taxa de entrega, pagamentos) e a chave de acesso.
// O emissor escolhido (Focus NFe, Nuvem Fiscal...) só traduz este formato para a API dele.

export class FiscalError extends Error {}

export const REGIME_LABEL: Record<TaxRegime, string> = {
  simples: "Simples Nacional",
  simples_excesso: "Simples Nacional, excesso de sublimite",
  normal: "Regime normal (Lucro Presumido ou Real)",
};

export const DEFAULT_FISCAL = { defaultNcm: "21069090", defaultCfop: "5102", defaultTaxCode: "102" } as const;

/** Prazo para cancelar NFC-e (a maioria dos estados aceita 30 minutos depois da autorização). */
export const CANCEL_MINUTES = 30;

const allSame = (d: string) => /^(\d)\1+$/.test(d);

export function validCnpj(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 14 || allSame(d)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((s, w, i) => s + Number(d[i]) * w, 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
}

export function validCpf(input: string): boolean {
  const d = onlyDigits(input);
  if (d.length !== 11 || allSame(d)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

export const formatCnpj = (v: string) => onlyDigits(v).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
export const formatCpf = (v: string) => onlyDigits(v).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
/** Chave de acesso em grupos de 4, como no DANFE. */
export const formatAccessKey = (k: string) => k.replace(/(\d{4})(?=\d)/g, "$1 ");

/** Confere o que o banco também confere, com a mensagem certa para o dono. */
export function fiscalConfigProblems(c: Pick<StoreFiscal, "cnpj" | "ie" | "legalName" | "defaultNcm" | "defaultCfop" | "defaultTaxCode">): string[] {
  const p: string[] = [];
  if (!validCnpj(c.cnpj)) p.push("Confira o CNPJ.");
  if (!/^\d{2,14}$/.test(onlyDigits(c.ie))) p.push("Informe a inscrição estadual (só números).");
  if (c.legalName.trim().length < 2) p.push("Informe a razão social.");
  if (!/^\d{8}$/.test(c.defaultNcm)) p.push("O NCM tem 8 números.");
  if (!/^\d{4}$/.test(c.defaultCfop)) p.push("O CFOP tem 4 números.");
  if (!/^\d{2,3}$/.test(c.defaultTaxCode)) p.push("O CSOSN/CST tem 2 ou 3 números.");
  return p;
}

export function productFiscalProblems(f: Product["fiscal"]): string[] {
  if (!f) return [];
  const p: string[] = [];
  if (f.ncm && !/^\d{8}$/.test(f.ncm)) p.push("O NCM tem 8 números.");
  if (f.cfop && !/^\d{4}$/.test(f.cfop)) p.push("O CFOP tem 4 números.");
  if (f.taxCode && !/^\d{2,3}$/.test(f.taxCode)) p.push("O CSOSN/CST tem 2 ou 3 números.");
  return p;
}

// ---------- a nota ----------

/** Meios de pagamento da NFC-e (tPag): 01 dinheiro, 03 crédito, 04 débito, 17 Pix. */
export type NfcePaymentCode = "01" | "03" | "04" | "17";

export interface NfceItem {
  code: string;
  description: string;
  ncm: string;
  cfop: string;
  taxCode: string;
  quantity: number;
  /** Centavos, com os adicionais. */
  unitPrice: number;
  total: number;
  /** Parte do desconto do pedido (cupom e cashback) que cabe a este item. */
  discount: number;
}

export interface NfcePayload {
  reference: string;
  environment: FiscalEnvironment;
  issuedAt: string;
  emitter: { cnpj: string; ie: string; legalName: string; regime: TaxRegime; tradeName: string; state: string; city: string };
  /** 1 presencial (balcão, retirada) · 4 entrega em domicílio. */
  presence: 1 | 4;
  consumerCpf?: string;
  items: NfceItem[];
  /** Taxa de entrega como outras despesas (NFC-e não leva frete). */
  otherCharges: number;
  discount: number;
  total: number;
  payments: { code: NfcePaymentCode; amount: number }[];
  change: number;
}

const PAYMENT_CODE: Record<Payment["method"], NfcePaymentCode> = { cash: "01", credit: "03", debit: "04", pix: "17" };
const PLANNED_CODE = { cash: "01", card: "03", pix: "17" } as const;

/** O que impede a nota deste pedido (vazio = pode emitir). */
export function nfceProblems(order: Order, fiscal: StoreFiscal | null | undefined, cpf?: string): string[] {
  const p: string[] = [];
  if (!fiscal || !fiscal.enabled) p.push("A emissão de NFC-e está desligada nas configurações fiscais.");
  if (order.status === "cancelado") p.push("Pedido cancelado não tem nota.");
  if (order.tabId || order.mode === "table") p.push("Pedido de mesa sai na nota da comanda.");
  if (order.total <= 0) p.push("Pedido sem valor não tem nota.");
  if (cpf && !validCpf(cpf)) p.push("Confira o CPF do cliente.");
  return p;
}

/** Monta a NFC-e do pedido. Os pagamentos registrados no caixa valem; sem eles, a forma escolhida no pedido. */
export function buildNfce(input: {
  order: Order;
  store: Pick<Store, "name" | "address">;
  fiscal: StoreFiscal;
  products: Pick<Product, "id" | "fiscal">[];
  payments: Payment[];
  cpf?: string;
  now: Date;
}): NfcePayload {
  const { order, store, fiscal, products, now } = input;
  const problems = nfceProblems(order, fiscal, input.cpf);
  if (problems.length) throw new FiscalError(problems[0]);

  const lines = order.items.map((it, i) => {
    const f = products.find((p) => p.id === it.productId)?.fiscal ?? {};
    const options = it.options.map((o) => o.optionName).join(", ");
    return {
      code: it.productId.slice(0, 60) || String(i + 1),
      description: (options ? `${it.name} (${options})` : it.name).slice(0, 120),
      ncm: f.ncm ?? fiscal.defaultNcm,
      cfop: f.cfop ?? fiscal.defaultCfop,
      taxCode: f.taxCode ?? fiscal.defaultTaxCode,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      total: it.unitPrice * it.quantity,
      discount: 0,
    };
  });
  const products$ = lines.reduce((s, l) => s + l.total, 0);
  let otherCharges = order.deliveryFee;
  // Desconto do pedido = cupom + cashback. O que passar dos itens (entrega grátis) sai da taxa de entrega.
  let discount = (order.discount ?? 0) + (order.cashbackUsed ?? 0);
  if (discount > products$) {
    const fromFee = Math.min(discount - products$, otherCharges);
    otherCharges -= fromFee;
    discount -= fromFee;
  }
  discount = Math.min(discount, products$);
  // Rateio proporcional; o resto dos centavos vai para o último item com valor.
  let left = discount;
  lines.forEach((l, i) => {
    const share = i === lines.length - 1 ? left : Math.min(left, Math.floor((discount * l.total) / Math.max(products$, 1)));
    l.discount = Math.min(share, l.total);
    left -= l.discount;
  });
  const total = products$ - discount + otherCharges;
  if (total !== order.total) throw new FiscalError("O total da nota não bate com o do pedido. Confira os itens.");

  const paid = input.payments.filter((p) => p.orderId === order.id);
  let payments: NfcePayload["payments"];
  let change = 0;
  if (paid.length) {
    const byCode = new Map<NfcePaymentCode, number>();
    for (const p of paid) byCode.set(PAYMENT_CODE[p.method], (byCode.get(PAYMENT_CODE[p.method]) ?? 0) + p.amount + p.changeGiven);
    payments = [...byCode].map(([code, amount]) => ({ code, amount }));
    change = paid.reduce((s, p) => s + p.changeGiven, 0);
    const covered = payments.reduce((s, p) => s + p.amount, 0) - change;
    if (covered < total) throw new FiscalError("O pedido ainda não foi pago por inteiro no caixa.");
  } else if (order.payment.method === "tab") {
    throw new FiscalError("Pedido de mesa sai na nota da comanda.");
  } else {
    const handed = order.payment.method === "cash" && order.payment.changeFor && order.payment.changeFor > total ? order.payment.changeFor : total;
    payments = [{ code: PLANNED_CODE[order.payment.method], amount: handed }];
    change = handed - total;
  }

  return {
    reference: order.id,
    environment: fiscal.environment,
    issuedAt: now.toISOString(),
    emitter: {
      cnpj: fiscal.cnpj,
      ie: fiscal.ie,
      legalName: fiscal.legalName,
      regime: fiscal.regime,
      tradeName: store.name,
      state: store.address.state.toUpperCase(),
      city: store.address.city,
    },
    presence: order.mode === "delivery" ? 4 : 1,
    consumerCpf: input.cpf ? onlyDigits(input.cpf) : undefined,
    items: lines,
    otherCharges,
    discount,
    total,
    payments,
    change,
  };
}

// ---------- chave de acesso ----------

const UF_CODE: Record<string, string> = {
  RO: "11", AC: "12", AM: "13", RR: "14", PA: "15", AP: "16", TO: "17", MA: "21", PI: "22", CE: "23", RN: "24", PB: "25", PE: "26",
  AL: "27", SE: "28", BA: "29", MG: "31", ES: "32", RJ: "33", SP: "35", PR: "41", SC: "42", RS: "43", MS: "50", MT: "51", GO: "52", DF: "53",
};

/** Dígito verificador da chave (módulo 11, pesos 2 a 9 da direita para a esquerda). */
export function accessKeyDigit(key43: string): number {
  let sum = 0;
  let w = 2;
  for (let i = key43.length - 1; i >= 0; i--) {
    sum += Number(key43[i]) * w;
    w = w === 9 ? 2 : w + 1;
  }
  const r = sum % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Chave de 44 números: UF, AAMM, CNPJ, modelo 65, série, número, tipo de emissão 1, código e DV. */
export function accessKey(p: { state: string; issuedAt: Date; cnpj: string; series: number; number: number; code: number }): string {
  const uf = UF_CODE[p.state.toUpperCase()] ?? "35";
  const yymm = `${String(p.issuedAt.getFullYear()).slice(2)}${String(p.issuedAt.getMonth() + 1).padStart(2, "0")}`;
  const key43 = `${uf}${yymm}${onlyDigits(p.cnpj).padStart(14, "0")}65${String(p.series).padStart(3, "0")}${String(p.number).padStart(9, "0")}1${String(p.code).padStart(8, "0")}`;
  return key43 + accessKeyDigit(key43);
}

// ---------- notas do pedido ----------

/** A nota que vale para o pedido: a ativa (processando ou autorizada); senão a última. */
export function orderDocument(docs: FiscalDocument[], orderId: string): FiscalDocument | undefined {
  const mine = docs.filter((d) => d.orderId === orderId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return mine.find((d) => d.status === "processing" || d.status === "authorized") ?? mine[0];
}

export function canCancelNfce(doc: FiscalDocument, now: Date): boolean {
  return doc.status === "authorized" && now.getTime() - new Date(doc.updatedAt).getTime() <= CANCEL_MINUTES * 60000;
}

/** A SEFAZ pede justificativa de 15 a 255 caracteres. */
export const validCancelReason = (r: string) => r.trim().length >= 15 && r.trim().length <= 255;
