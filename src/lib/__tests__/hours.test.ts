import { describe, expect, it } from "vitest";
import { isStoreOpen, storeStatus } from "@/lib/domain/hours";
import type { WeeklyHours } from "@/lib/types";
import { emptyHours } from "@/lib/domain/hours";

// 2026-11-23 é uma segunda-feira.
const at = (day: number, hh: number, mm = 0) => new Date(2026, 10, day, hh, mm);

const daily: WeeklyHours = {
  0: [{ open: "11:00", close: "23:30" }],
  1: [{ open: "11:00", close: "23:30" }],
  2: [{ open: "11:00", close: "23:30" }],
  3: [{ open: "11:00", close: "23:30" }],
  4: [{ open: "11:00", close: "23:30" }],
  5: [{ open: "11:00", close: "01:00" }],
  6: [{ open: "11:00", close: "01:00" }],
};

describe("horário de funcionamento", () => {
  it("está aberto dentro do intervalo", () => {
    const s = storeStatus({ hours: daily, manualStatus: "auto" }, at(23, 12));
    expect(s).toEqual({ open: true, label: "Aberto até 23h30" });
  });

  it("antes de abrir diz que abre hoje", () => {
    expect(storeStatus({ hours: daily, manualStatus: "auto" }, at(23, 10)).label).toBe("Fechado · abre hoje às 11h");
  });

  it("depois de fechar diz que abre amanhã", () => {
    expect(storeStatus({ hours: daily, manualStatus: "auto" }, at(23, 23, 45)).label).toBe(
      "Fechado · abre amanhã às 11h",
    );
  });

  it("intervalo que vira a meia-noite continua aberto no dia seguinte", () => {
    // Sábado 28/11 às 00:30 ainda é o expediente de sexta.
    const s = storeStatus({ hours: daily, manualStatus: "auto" }, at(28, 0, 30));
    expect(s).toEqual({ open: true, label: "Aberto até 1h" });
  });

  it("usa o nome do dia quando a próxima abertura está a mais de um dia", () => {
    const onlyWednesday: WeeklyHours = { ...emptyHours(), 3: [{ open: "18:00", close: "23:00" }] };
    expect(storeStatus({ hours: onlyWednesday, manualStatus: "auto" }, at(23, 12)).label).toBe(
      "Fechado · abre quarta às 18h",
    );
  });

  it("status manual sobrepõe os horários", () => {
    expect(isStoreOpen({ hours: daily, manualStatus: "closed" }, at(23, 12))).toBe(false);
    expect(storeStatus({ hours: daily, manualStatus: "closed" }, at(23, 12)).label).toBe("Fechado no momento");
    expect(storeStatus({ hours: daily, manualStatus: "open" }, at(23, 4))).toEqual({ open: true, label: "Aberto agora" });
  });

  it("sem nenhum horário fica só fechado", () => {
    expect(storeStatus({ hours: emptyHours(), manualStatus: "auto" }, at(23, 12)).label).toBe("Fechado");
  });
});
