import type { Order, OrderMode, Store } from "@/lib/types";
import { isStoreOpen } from "@/lib/domain/hours";

// Pedido agendado. O banco (SQL 008, check_schedule) aplica as mesmas regras e mensagens:
// horários de 30 em 30 min, dentro do expediente do dia (o abrir/fechar manual não vale para o
// futuro), com antecedência mínima e até alguns dias à frente; mesa não agenda.

export const DEFAULT_SCHEDULING = { enabled: false, leadMinutes: 60, maxDays: 7 } as const;
const SLOT_MS = 30 * 60_000;

export class ScheduleError extends Error {}

export function schedulingOf(store: Pick<Store, "scheduling">): { enabled: boolean; leadMinutes: number; maxDays: number } {
  const s = store.scheduling ?? DEFAULT_SCHEDULING;
  return {
    enabled: s.enabled,
    leadMinutes: Math.min(Math.max(s.leadMinutes, 15), 1440),
    maxDays: Math.min(Math.max(s.maxDays, 1), 14),
  };
}

export function canSchedule(store: Pick<Store, "scheduling">, mode: OrderMode | null): boolean {
  return schedulingOf(store).enabled && mode !== "table";
}

/** Aberto nesse horário pelos horários cadastrados, ignorando o abrir/fechar manual. */
function openByHours(store: Pick<Store, "hours">, at: Date): boolean {
  return isStoreOpen({ hours: store.hours, manualStatus: "auto" }, at);
}

export interface SlotDay {
  day: Date;
  label: string;
  slots: Date[];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function dayLabel(day: Date, now: Date): string {
  const diff = Math.round((startOfDay(day).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Amanhã";
  return day.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

/** Horários disponíveis, agrupados por dia. */
export function scheduleSlots(store: Pick<Store, "hours" | "scheduling">, now: Date): SlotDay[] {
  const cfg = schedulingOf(store);
  if (!cfg.enabled) return [];
  const first = Math.ceil((now.getTime() + cfg.leadMinutes * 60_000) / SLOT_MS) * SLOT_MS;
  const last = now.getTime() + cfg.maxDays * 86_400_000;
  const days = new Map<number, SlotDay>();
  for (let t = first; t <= last; t += SLOT_MS) {
    const at = new Date(t);
    if (!openByHours(store, at)) continue;
    const key = startOfDay(at).getTime();
    if (!days.has(key)) days.set(key, { day: new Date(key), label: dayLabel(at, now), slots: [] });
    days.get(key)!.slots.push(at);
  }
  return [...days.values()];
}

/** Confere o horário escolhido (o mesmo que check_schedule no banco). */
export function checkSchedule(store: Pick<Store, "hours" | "scheduling">, at: Date, mode: OrderMode, now: Date) {
  const cfg = schedulingOf(store);
  if (!cfg.enabled) throw new ScheduleError("Esta loja não aceita pedidos agendados.");
  if (mode === "table") throw new ScheduleError("Pedido na mesa não pode ser agendado.");
  if (Number.isNaN(at.getTime()) || at.getTime() % SLOT_MS !== 0) throw new ScheduleError("Escolha um dos horários da lista.");
  if (at.getTime() < now.getTime() + cfg.leadMinutes * 60_000) throw new ScheduleError("Esse horário já não dá mais. Escolha outro.");
  if (at.getTime() > now.getTime() + cfg.maxDays * 86_400_000) throw new ScheduleError(`Dá para agendar até ${cfg.maxDays} dias à frente.`);
  if (!openByHours(store, at)) throw new ScheduleError("A loja está fechada nesse horário.");
}

/** Minutos antes do horário em que o pedido agendado entra na tela de preparo. */
export function prepLeadMinutes(order: Pick<Order, "mode">, store: Pick<Store, "delivery" | "pickup">): number {
  return order.mode === "delivery" ? store.delivery.etaMax : store.pickup.etaMax;
}

/** Pedido agendado só vai para a cozinha perto da hora; os outros, na hora. */
export function readyForKitchen(order: Pick<Order, "mode" | "scheduledFor">, store: Pick<Store, "delivery" | "pickup">, now: Date): boolean {
  if (!order.scheduledFor) return true;
  return now.getTime() >= new Date(order.scheduledFor).getTime() - prepLeadMinutes(order, store) * 60_000;
}

export function scheduledLabel(iso: string, now: Date): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const label = dayLabel(at, now);
  return `${label === "Hoje" || label === "Amanhã" ? label.toLowerCase() : label} às ${time}`;
}
