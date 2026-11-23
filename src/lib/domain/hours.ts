import type { OpeningInterval, Store, Weekday, WeeklyHours } from "@/lib/types";
import { WEEKDAY_NAMES, formatHour } from "@/lib/format";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function atMinutes(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** Intervalos concretos (com data) que começam no dia dado. Intervalos que viram a meia-noite terminam no dia seguinte. */
function intervalsOn(hours: WeeklyHours, day: Date): { start: Date; end: Date }[] {
  const weekday = day.getDay() as Weekday;
  return (hours[weekday] ?? []).map((iv: OpeningInterval) => {
    const open = toMinutes(iv.open);
    let close = toMinutes(iv.close);
    if (close <= open) close += 24 * 60;
    return { start: atMinutes(day, open), end: atMinutes(day, close) };
  });
}

/** Intervalo aberto em `now` segundo os horários (ignora o status manual). */
export function currentInterval(hours: WeeklyHours, now: Date) {
  const today = startOfDay(now);
  const candidates = [...intervalsOn(hours, addDays(today, -1)), ...intervalsOn(hours, today)];
  return candidates.find((iv) => now >= iv.start && now < iv.end) ?? null;
}

export function nextOpening(hours: WeeklyHours, now: Date): Date | null {
  const today = startOfDay(now);
  for (let i = 0; i <= 7; i++) {
    const starts = intervalsOn(hours, addDays(today, i))
      .map((iv) => iv.start)
      .filter((s) => s > now)
      .sort((a, b) => a.getTime() - b.getTime());
    if (starts.length) return starts[0];
  }
  return null;
}

export function isStoreOpen(store: Pick<Store, "hours" | "manualStatus">, now: Date): boolean {
  if (store.manualStatus === "open") return true;
  if (store.manualStatus === "closed") return false;
  return currentInterval(store.hours, now) !== null;
}

export interface StoreStatus {
  open: boolean;
  /** Frase curta para o cliente: "Aberto até 23h", "Abre amanhã às 11h". */
  label: string;
}

export function storeStatus(store: Pick<Store, "hours" | "manualStatus">, now: Date): StoreStatus {
  if (store.manualStatus === "open") {
    const iv = currentInterval(store.hours, now);
    return { open: true, label: iv ? `Aberto até ${formatHour(iv.end)}` : "Aberto agora" };
  }
  if (store.manualStatus === "auto") {
    const iv = currentInterval(store.hours, now);
    if (iv) return { open: true, label: `Aberto até ${formatHour(iv.end)}` };
  }
  const next = nextOpening(store.hours, now);
  if (!next || store.manualStatus === "closed") {
    // Fechado manualmente: o dono decide quando reabrir, então não prometemos horário.
    return { open: false, label: store.manualStatus === "closed" ? "Fechado no momento" : "Fechado" };
  }
  const days = Math.round((startOfDay(next).getTime() - startOfDay(now).getTime()) / 86400000);
  const when =
    days === 0 ? "hoje" : days === 1 ? "amanhã" : WEEKDAY_NAMES[next.getDay()];
  return { open: false, label: `Fechado · abre ${when} às ${formatHour(next)}` };
}

export function emptyHours(): WeeklyHours {
  return { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
