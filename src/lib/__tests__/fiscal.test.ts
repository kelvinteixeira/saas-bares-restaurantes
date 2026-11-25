import { describe, expect, it } from "vitest";
import type { Order, Payment, StoreFiscal } from "@/lib/types";
import {
  accessKey,
  accessKeyDigit,
  buildNfce,
  canCancelNfce,
  fiscalConfigProblems,
  nfceProblems,
  orderDocument,
  validCancelReason,
  validCnpj,
  validCpf,
} from "@/lib/domain/fiscal";

const fiscal: StoreFiscal = {
  storeId: "s",
  enabled: true,
  environment: "homologacao",
  cnpj: "11222333000181",
  ie: "0321418406",
  legalName: "Bar do Cais LTDA",
  regime: "simples",
  defaultNcm: "21069090",
  defaultCfop: "5102",
  defaultTaxCode: "102",
  updatedAt: "",
};
const store = { name: "Bar do Cais", address: { street: "", number: "", district: "", city: "Recife", state: "pe" } };
const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  storeId: "s",
  number: 7,
  createdAt: "",
  promisedAt: "",
  status: "concluido",
  history: [],
  mode: "delivery",
  customer: { name: "Ana", phone: "81999990000" },
  items: [
    { productId: "p-isca", name: "Isca de peixe", unitPrice: 4200, quantity: 2, options: [] },
    { productId: "p-chopp", name: "Chopp", unitPrice: 1200, quantity: 3, options: [{ groupName: "Tamanho", optionName: "500 ml", price: 300 }] },
  ],
  subtotal: 12000,
  deliveryFee: 700,
  total: 12700,
  payment: { method: "pix" },
  ...over,
});
const products = [{ id: "p-chopp", fiscal: { ncm: "22030000", cfop: "5405", taxCode: "500" } }, { id: "p-isca" }];
const now = new Date("2026-11-25T12:00:00Z");

describe("NFC-e", () => {
  it("confere CNPJ, CPF e os dados da loja", () => {
    expect(validCnpj("11.222.333/0001-81")).toBe(true);
    expect(validCnpj("11.222.333/0001-82")).toBe(false);
    expect(validCnpj("11111111111111")).toBe(false);
    expect(validCpf("529.982.247-25")).toBe(true);
    expect(validCpf("529.982.247-24")).toBe(false);
    expect(fiscalConfigProblems(fiscal)).toEqual([]);
    expect(fiscalConfigProblems({ ...fiscal, cnpj: "123", defaultNcm: "2106" })).toEqual(["Confira o CNPJ.", "O NCM tem 8 números."]);
  });

  it("itens com os códigos do produto ou os padrões da loja; entrega como outras despesas", () => {
    const n = buildNfce({ order: order(), store, fiscal, products, payments: [], now });
    expect(n.items.map((i) => [i.ncm, i.cfop, i.taxCode])).toEqual([
      ["21069090", "5102", "102"],
      ["22030000", "5405", "500"],
    ]);
    expect(n.items[1].description).toBe("Chopp (500 ml)");
    expect(n).toMatchObject({ presence: 4, otherCharges: 700, discount: 0, total: 12700, change: 0, payments: [{ code: "17", amount: 12700 }] });
    expect(n.emitter.state).toBe("PE");
  });

  it("cupom e cashback viram desconto rateado nos itens, fechando o total do pedido", () => {
    const n = buildNfce({ order: order({ discount: 1000, cashbackUsed: 333, total: 12700 - 1333 }), store, fiscal, products, payments: [], now });
    expect(n.discount).toBe(1333);
    expect(n.items.reduce((s, i) => s + i.discount, 0)).toBe(1333);
    expect(n.items.every((i) => i.discount <= i.total)).toBe(true);
    expect(n.total).toBe(12700 - 1333);
  });

  it("desconto maior que os itens (entrega grátis num pedido pequeno) sai da taxa de entrega", () => {
    const small = order({ items: [{ productId: "p-isca", name: "Isca", unitPrice: 500, quantity: 1, options: [] }], subtotal: 500, deliveryFee: 700, discount: 900, total: 300 });
    const n = buildNfce({ order: small, store, fiscal, products, payments: [], now });
    expect(n).toMatchObject({ discount: 500, otherCharges: 300, total: 300 });
  });

  it("pagamentos do caixa valem (com troco); sem eles, a forma do pedido", () => {
    const pay = (method: Payment["method"], amount: number, changeGiven = 0): Payment => ({ id: method, storeId: "s", cashSessionId: "c", orderId: "o1", method, amount, changeGiven, createdAt: "" });
    const n = buildNfce({ order: order(), store, fiscal, products, payments: [pay("debit", 7000), pay("cash", 5700, 4300)], now });
    expect(n.payments).toEqual([
      { code: "04", amount: 7000 },
      { code: "01", amount: 10000 },
    ]);
    expect(n.change).toBe(4300);
    expect(() => buildNfce({ order: order(), store, fiscal, products, payments: [pay("pix", 5000)], now })).toThrow("pago por inteiro");
    const cash = buildNfce({ order: order({ payment: { method: "cash", changeFor: 15000 } }), store, fiscal, products, payments: [], now });
    expect(cash).toMatchObject({ payments: [{ code: "01", amount: 15000 }], change: 2300 });
    expect(buildNfce({ order: order({ payment: { method: "card" }, mode: "pickup", deliveryFee: 0, total: 12000 }), store, fiscal, products, payments: [], now })).toMatchObject({
      presence: 1,
      payments: [{ code: "03", amount: 12000 }],
    });
  });

  it("não emite com a emissão desligada, pedido cancelado, de mesa ou CPF errado", () => {
    expect(nfceProblems(order(), { ...fiscal, enabled: false })[0]).toContain("desligada");
    expect(nfceProblems(order({ status: "cancelado" }), fiscal)[0]).toContain("cancelado");
    expect(nfceProblems(order({ mode: "table", tabId: "t" }), fiscal)[0]).toContain("comanda");
    expect(nfceProblems(order(), fiscal, "123")[0]).toContain("CPF");
    expect(buildNfce({ order: order(), store, fiscal, products, payments: [], cpf: "529.982.247-25", now }).consumerCpf).toBe("52998224725");
  });

  it("chave de acesso: 44 números com dígito verificador de módulo 11", () => {
    // Exemplo do manual da NF-e: DV 5.
    expect(accessKeyDigit("5206043300991100250655012000000780026730161")).toBe(5);
    const k = accessKey({ state: "PE", issuedAt: now, cnpj: "11222333000181", series: 1, number: 42, code: 12345678 });
    expect(k).toMatch(/^\d{44}$/);
    expect(k.slice(0, 6)).toBe("262611");
    expect(k.slice(20, 22)).toBe("65");
    expect(Number(k[43])).toBe(accessKeyDigit(k.slice(0, 43)));
  });

  it("nota ativa do pedido e prazo de cancelamento", () => {
    const doc = (status: "authorized" | "rejected" | "cancelled", createdAt: string) => ({
      id: status + createdAt,
      storeId: "s",
      orderId: "o1",
      environment: "homologacao" as const,
      provider: "simulador",
      status,
      total: 100,
      createdAt,
      updatedAt: createdAt,
    });
    const rejected = doc("rejected", "2026-11-25T12:10:00Z");
    const ok = doc("authorized", "2026-11-25T12:05:00Z");
    expect(orderDocument([ok, rejected], "o1")).toBe(ok);
    expect(orderDocument([rejected], "o1")).toBe(rejected);
    expect(canCancelNfce(ok, new Date("2026-11-25T12:30:00Z"))).toBe(true);
    expect(canCancelNfce(ok, new Date("2026-11-25T12:40:00Z"))).toBe(false);
    expect(validCancelReason("erro")).toBe(false);
    expect(validCancelReason("Cliente desistiu do pedido")).toBe(true);
  });
});
