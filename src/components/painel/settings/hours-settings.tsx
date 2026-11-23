"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Weekday, WeeklyHours } from "@/lib/types";
import { usePainel } from "@/components/painel/painel-context";
import { SaveBar, SettingsSection } from "@/components/painel/settings/section";
import { Switch, inputClass } from "@/components/ui/field";
import { attempt, useToast } from "@/components/ui/toast";
import { isValidTime, storeStatus } from "@/lib/domain/hours";
import { WEEKDAY_NAMES } from "@/lib/format";
import { updateStore } from "@/lib/store/actions";
import { cn } from "@/lib/cn";

/** Turnos do mesmo dia que se cruzam (o fechamento depois da meia-noite conta como dia seguinte). */
function intervalsOverlap(intervals: { open: string; close: string }[]) {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const spans = intervals
    .map((iv) => {
      const start = toMin(iv.open);
      let end = toMin(iv.close);
      if (end <= start) end += 24 * 60;
      return [start, end] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  return spans.some((span, i) => i > 0 && span[0] < spans[i - 1][1]);
}

// Semana começando na segunda, como o balcão pensa.
const ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export function HoursSettings() {
  const { store, now } = usePainel();
  const toast = useToast();
  const [hours, setHours] = useState<WeeklyHours>(() => structuredClone(store.hours));
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(hours) !== JSON.stringify(store.hours);
  const preview = storeStatus({ hours, manualStatus: "auto" }, now);

  const setDay = (day: Weekday, intervals: WeeklyHours[Weekday]) => setHours((h) => ({ ...h, [day]: intervals }));

  async function save() {
    for (const day of ORDER) {
      for (const iv of hours[day]) {
        if (!isValidTime(iv.open) || !isValidTime(iv.close)) {
          setError(`Confira os horários de ${WEEKDAY_NAMES[day]}.`);
          return;
        }
        if (iv.open === iv.close) {
          setError(`Em ${WEEKDAY_NAMES[day]}, abertura e fechamento estão iguais.`);
          return;
        }
      }
      if (intervalsOverlap(hours[day])) {
        setError(`Em ${WEEKDAY_NAMES[day]}, os dois turnos se sobrepõem.`);
        return;
      }
    }
    setError(null);
    await attempt(
      toast,
      () =>
        updateStore(store.id, (s) => {
          s.hours = hours;
        }),
      "Horários salvos",
    );
  }

  return (
    <SettingsSection
      title="Horário de funcionamento"
      description={
        <>
          <p>Fora destes horários o cardápio continua visível, mas não aceita pedidos. Para fechar depois da meia-noite, coloque o fechamento menor que a abertura, por exemplo 18:00 às 02:00.</p>
          <p className="mt-3">
            Com estes horários, agora o cliente vê:{" "}
            <span className={cn("font-medium", preview.open ? "text-positive" : "text-ink")}>{preview.label}</span>
          </p>
        </>
      }
    >
      <ul className="flex flex-col">
        {ORDER.map((day) => {
          const intervals = hours[day];
          const open = intervals.length > 0;
          return (
            <li key={day} className="grid grid-cols-[96px_44px_1fr] items-start gap-3 border-t border-rule py-3 first:border-t-0 first:pt-0">
              <span className="pt-2 text-sm font-medium capitalize">{WEEKDAY_NAMES[day]}</span>
              <span className="pt-2.5">
                <Switch
                  checked={open}
                  label={`Abre ${WEEKDAY_NAMES[day]}`}
                  onChange={(v) => setDay(day, v ? [{ open: "11:00", close: "23:00" }] : [])}
                />
              </span>
              <div className="flex flex-col gap-2">
                {!open && <span className="pt-2 text-sm text-muted">Fechado</span>}
                {intervals.map((iv, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input
                      type="time"
                      aria-label={`${WEEKDAY_NAMES[day]}, abre às`}
                      value={iv.open}
                      onChange={(e) => setDay(day, intervals.map((x, j) => (j === i ? { ...x, open: e.target.value } : x)))}
                      className={cn(inputClass, "num w-[112px]")}
                    />
                    <span className="text-sm text-muted">às</span>
                    <input
                      type="time"
                      aria-label={`${WEEKDAY_NAMES[day]}, fecha às`}
                      value={iv.close}
                      onChange={(e) => setDay(day, intervals.map((x, j) => (j === i ? { ...x, close: e.target.value } : x)))}
                      className={cn(inputClass, "num w-[112px]")}
                    />
                    {intervals.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remover este horário"
                        onClick={() => setDay(day, intervals.filter((_, j) => j !== i))}
                        className="grid size-9 place-items-center rounded-control text-muted hover:bg-pill-negative-bg hover:text-negative"
                      >
                        <Trash2 className="size-4" strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                ))}
                {open && intervals.length < 2 && (
                  <button
                    type="button"
                    onClick={() => setDay(day, [...intervals, { open: "18:00", close: "23:00" }])}
                    className="inline-flex h-8 w-fit items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
                  >
                    <Plus className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
                    Segundo turno
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 border-t border-rule pt-3">
        <button
          type="button"
          onClick={() => setHours((h) => Object.fromEntries(ORDER.map((d) => [d, structuredClone(h[1])])) as unknown as WeeklyHours)}
          className="text-sm font-medium text-accent hover:underline"
        >
          Repetir os horários de segunda em todos os dias
        </button>
      </div>
      {error && <p className="mt-3 text-sm text-negative">{error}</p>}
      <SaveBar dirty={dirty} onSave={save} onReset={() => {
          setHours(structuredClone(store.hours));
          setError(null);
        }} />
    </SettingsSection>
  );
}
