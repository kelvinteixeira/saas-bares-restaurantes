import { describe, expect, it } from "vitest";
import { demoProducts } from "@/lib/seed";
import { fromPrice, groupRule, hasVariablePrice, unitPrice, validateSelections } from "@/lib/domain/pricing";
import { formatMoney, parseMoney } from "@/lib/format";

const products = demoProducts();
const byId = (id: string) => products.find((p) => p.id === id)!;

describe("preço", () => {
  it("soma base e adicionais escolhidos", () => {
    const batata = byId("p-batata");
    expect(unitPrice(batata, { "g-batata-tam": ["o-inteira"], "g-batata-add": ["o-cheddar"] })).toBe(2400 + 1400 + 600);
  });

  it("'a partir de' usa a opção mais barata dos grupos obrigatórios", () => {
    expect(fromPrice(byId("p-batata"))).toBe(2400);
    expect(hasVariablePrice(byId("p-batata"))).toBe(true);
    // Todas as proteínas custam o mesmo: preço fixo.
    expect(hasVariablePrice(byId("p-baiao"))).toBe(false);
  });

  it("valida mínimo e máximo de cada grupo", () => {
    const pastel = byId("p-pastel");
    expect(validateSelections(pastel, {})).toEqual({ "g-pastel-sabor": "Escolha uma opção em Sabor" });
    expect(validateSelections(pastel, { "g-pastel-sabor": ["o-queijo", "o-carne", "o-camarao"] })).toEqual({
      "g-pastel-sabor": "No máximo 2 em Sabor",
    });
    expect(validateSelections(pastel, { "g-pastel-sabor": ["o-queijo"] })).toEqual({});
  });

  it("descreve a regra do grupo em palavras", () => {
    expect(groupRule({ id: "a", name: "x", min: 1, max: 1, options: [] })).toBe("Escolha 1");
    expect(groupRule({ id: "a", name: "x", min: 1, max: 2, options: [] })).toBe("Escolha de 1 a 2");
    expect(groupRule({ id: "a", name: "x", min: 0, max: 3, options: [] })).toBe("Opcional, até 3");
  });
});

describe("dinheiro", () => {
  it("lê valores digitados no formato brasileiro", () => {
    expect(parseMoney("12,50")).toBe(1250);
    expect(parseMoney("R$ 1.234,56")).toBe(123456);
    expect(parseMoney("7")).toBe(700);
    expect(parseMoney("abc")).toBeNull();
    // Ponto como separador de milhar, do jeito que muita gente digita.
    expect(parseMoney("1.234")).toBe(123400);
    expect(parseMoney("12.500")).toBe(1250000);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("12.50")).toBe(1250);
    expect(parseMoney("-5")).toBeNull();
  });

  it("formata em reais", () => {
    expect(formatMoney(123456).replace(/\s/g, " ")).toBe("R$ 1.234,56");
  });
});
