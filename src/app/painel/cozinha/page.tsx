"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, LogOut, Maximize, Minimize, Volume2, VolumeX } from "lucide-react";
import type { OrderItem } from "@/lib/types";
import {
  kitchenTickets,
  minutesSince,
  urgency,
  type KitchenTicket,
  type StationFilter,
} from "@/lib/domain/kitchen";
import { formatClock, formatOrderNumber } from "@/lib/format";
import { advanceOrder } from "@/lib/store/actions";
import { signOut } from "@/lib/store/auth";
import { cn } from "@/lib/cn";
import { usePainel } from "@/components/painel/painel-context";
import { attempt, useToast } from "@/components/ui/toast";

const STATIONS: { value: StationFilter; label: string }[] = [
  { value: "kitchen", label: "Cozinha" },
  { value: "bar", label: "Bar" },
  { value: "all", label: "Tudo" },
];

const STATION_KEY = "comanda:setor";

function useStation(): [StationFilter, (s: StationFilter) => void] {
  const [station, setStation] = useState<StationFilter>(() => {
    try {
      const saved = window.localStorage.getItem(STATION_KEY);
      return saved === "bar" || saved === "all" ? saved : "kitchen";
    } catch {
      return "kitchen";
    }
  });
  const update = (s: StationFilter) => {
    setStation(s);
    try {
      window.localStorage.setItem(STATION_KEY, s);
    } catch {
      // vale só nesta aba
    }
  };
  return [station, update];
}

export default function CozinhaPage() {
  const { db, store, now, role, soundOn, setSoundOn } = usePainel();
  const router = useRouter();
  const toast = useToast();
  const [station, setStation] = useStation();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [fullscreen, setFullscreen] = useState(false);

  const orders = db.orders.filter((o) => o.storeId === store.id);
  const tickets = kitchenTickets(orders, db.products, station, now);
  const waiting = tickets.filter((t) => t.order.status === "novo").length;
  const cooking = tickets.filter((t) => t.order.status === "em_preparo").length;

  async function advance(id: string) {
    if (busy.has(id)) return;
    setBusy((s) => new Set(s).add(id));
    await attempt(toast, () => advanceOrder(id));
    setBusy((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFullscreen(false);
      } else {
        await document.documentElement.requestFullscreen();
        setFullscreen(true);
      }
    } catch {
      toast("Este navegador não deixou usar a tela cheia.", "negative");
    }
  }

  const iconButton =
    "grid size-11 place-items-center rounded-[10px] text-[#d4d4d8] transition-colors hover:bg-white/10 hover:text-white";

  return (
    <div className="flex min-h-dvh flex-col bg-[#0e0e10] text-white">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 bg-[#0e0e10]/95 px-4 py-2.5 backdrop-blur sm:px-6">
        {role !== "kitchen" && (
          <Link href="/painel/pedidos" className={iconButton} aria-label="Voltar ao painel">
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </Link>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="whitespace-nowrap text-lg font-semibold leading-6">Tela de preparo</h1>
          <p className="truncate text-[13px] text-[#a1a1aa]">
            {store.name} · <span className="num">{waiting}</span> {waiting === 1 ? "novo" : "novos"} ·{" "}
            <span className="num">{cooking}</span> em preparo
          </p>
        </div>

        <div role="radiogroup" aria-label="Setor" className="order-last flex w-full rounded-[12px] bg-white/[0.07] p-1 sm:order-none sm:w-auto">
          {STATIONS.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={station === s.value}
              onClick={() => setStation(s.value)}
              className={cn(
                "h-9 flex-1 rounded-[9px] px-4 text-sm font-medium text-[#d4d4d8] transition-colors hover:text-white",
                station === s.value && "bg-white text-[#0e0e10] hover:text-[#0e0e10]",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          <span className="num mr-2 hidden text-2xl font-semibold tabular-nums sm:block">{formatClock(now)}</span>
          <button
            type="button"
            onClick={() => setSoundOn(!soundOn)}
            aria-pressed={soundOn}
            aria-label="Som de pedido novo"
            className={iconButton}
          >
            {soundOn ? <Volume2 className="size-5" strokeWidth={1.75} /> : <VolumeX className="size-5" strokeWidth={1.75} />}
          </button>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Sair da tela cheia" : "Tela cheia"} className={iconButton}>
            {fullscreen ? <Minimize className="size-5" strokeWidth={1.75} /> : <Maximize className="size-5" strokeWidth={1.75} />}
          </button>
          {role === "kitchen" && (
            <button
              type="button"
              aria-label="Sair da conta"
              className={iconButton}
              onClick={async () => {
                await signOut();
                router.replace("/entrar");
              }}
            >
              <LogOut className="size-5" strokeWidth={1.75} />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 py-5 sm:px-6">
        {tickets.length === 0 ? (
          <div className="grid min-h-[60vh] place-items-center text-center">
            <div>
              <p className="text-2xl font-semibold">Nada para preparar agora</p>
              <p className="mt-2 text-[15px] text-[#a1a1aa]">
                {station === "bar" ? "Os pedidos com itens do bar" : station === "kitchen" ? "Os pedidos com itens da cozinha" : "Os pedidos novos"}{" "}
                aparecem aqui sozinhos{soundOn ? ", com aviso sonoro" : ""}.
              </p>
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(290px,1fr))] items-start gap-4">
            {tickets.map((t) => (
              <Ticket
                key={t.order.id}
                ticket={t}
                now={now}
                busy={busy.has(t.order.id)}
                onAdvance={() => void advance(t.order.id)}
                stationLabel={station === "bar" ? "da cozinha" : station === "kitchen" ? "do bar" : ""}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

function Ticket({
  ticket,
  now,
  busy,
  onAdvance,
  stationLabel,
}: {
  ticket: KitchenTicket;
  now: Date;
  busy: boolean;
  onAdvance: () => void;
  stationLabel: string;
}) {
  const { order, items, otherItems, readyAt } = ticket;
  const ready = readyAt !== null;
  const level = ready ? "ok" : urgency(order, now);
  const minutes = minutesSince(order.createdAt, now);
  const where =
    order.mode === "table"
      ? `Mesa ${order.tableNumber ?? "?"}`
      : `${order.mode === "pickup" ? "Retirada" : "Entrega"} · ${order.customer.name}`;

  return (
    <li
      className={cn(
        "flex flex-col overflow-hidden rounded-[16px] border-2 bg-[#1a1a1d] transition-opacity",
        ready && "opacity-55",
        !ready && level === "ok" && "border-white/10",
        level === "warn" && "border-[#f5b301]",
        level === "late" && "border-[#ef4444]",
        ready && "border-[#22c55e]/60",
      )}
    >
      <div
        className={cn(
          "flex items-start justify-between gap-3 px-4 pt-3.5 pb-3",
          level === "warn" && "bg-[#f5b301]/12",
          level === "late" && "bg-[#ef4444]/15",
        )}
      >
        <div className="min-w-0">
          <p className="num text-[26px] font-bold leading-8 tracking-tight">{formatOrderNumber(order.number)}</p>
          <p className="truncate text-[15px] font-medium text-[#e4e4e7]">{where}</p>
        </div>
        <div className="text-right">
          <p
            className={cn(
              "num text-[22px] font-semibold leading-8 tabular-nums",
              level === "warn" && "text-[#fcd34d]",
              level === "late" && "text-[#fca5a5]",
            )}
          >
            {ready ? "Pronto" : `${minutes} min`}
          </p>
          <p className="text-[13px] text-[#a1a1aa]">
            {ready ? `há ${minutesSince(readyAt!.toISOString(), now)} min` : order.status === "novo" ? "Novo" : "Em preparo"}
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-3 border-t border-white/10 px-4 py-3.5">
        {items.map((item, i) => (
          <TicketItem key={`${item.productId}-${i}`} item={item} />
        ))}
      </ul>

      {(order.notes || otherItems > 0) && (
        <div className="flex flex-col gap-2 px-4 pb-3.5">
          {order.notes && (
            <p className="rounded-[10px] bg-[#f5b301] px-3 py-2 text-[15px] font-semibold leading-5 text-[#1a1a1d]">
              {order.notes}
            </p>
          )}
          {otherItems > 0 && stationLabel && (
            <p className="text-[13px] text-[#a1a1aa]">
              + {otherItems} {otherItems === 1 ? "item" : "itens"} {stationLabel} no mesmo pedido
            </p>
          )}
        </div>
      )}

      {!ready && (
        <button
          type="button"
          onClick={onAdvance}
          disabled={busy}
          className={cn(
            "mt-auto h-14 text-[17px] font-semibold transition-colors disabled:opacity-60",
            order.status === "novo" ? "bg-white text-[#0e0e10] hover:bg-[#e4e4e7]" : "bg-[#22c55e] text-[#052e16] hover:bg-[#4ade80]",
          )}
        >
          {busy ? "Salvando…" : order.status === "novo" ? "Começar preparo" : "Pronto"}
        </button>
      )}
    </li>
  );
}

function TicketItem({ item }: { item: OrderItem }) {
  // Agrupa as opções pelo nome do grupo: "Tamanho: Inteira · Adicionais: Bacon, Cheddar".
  const groups = new Map<string, string[]>();
  for (const o of item.options) groups.set(o.groupName, [...(groups.get(o.groupName) ?? []), o.optionName]);
  return (
    <li>
      <p className="text-[19px] font-semibold leading-6">
        <span className="num mr-1.5 text-[#fbbf24]">{item.quantity}×</span>
        {item.name}
      </p>
      {groups.size > 0 && (
        <p className="mt-0.5 text-[15px] leading-5 text-[#d4d4d8]">
          {[...groups].map(([g, opts]) => `${g}: ${opts.join(", ")}`).join(" · ")}
        </p>
      )}
      {item.notes && (
        <p className="mt-1.5 rounded-[8px] bg-[#f5b301]/20 px-2 py-1 text-[15px] font-medium text-[#fde68a]">{item.notes}</p>
      )}
    </li>
  );
}
