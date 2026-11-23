import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";

// Trechos da interface real, desenhados com os mesmos tokens do produto (data-ui).
// Os dados são do bar de exemplo da demonstração.

export function MenuFragment({ className }: { className?: string }) {
  const items = [
    { name: "Batata frita", desc: "Cortada na casa, frita duas vezes. Maionese verde.", price: 2400, from: true },
    { name: "Isca de peixe", desc: "Tiras de pescada empanadas, limão e tártaro.", price: 4200 },
    { name: "Bolinho de bacalhau", desc: "8 unidades.", price: 3600 },
    { name: "Torresmo de rolo", desc: "Pururuca por fora, macio por dentro.", price: 3200, soldOut: true },
  ];
  return (
    <div data-ui className={cn("overflow-hidden rounded-[28px] border-[6px] border-ink bg-surface", className)} aria-hidden="true">
      <div className="h-16 bg-[#b84a00]" />
      <div className="px-4">
        <div className="-mt-7 grid size-14 place-items-center rounded-full border-4 border-surface bg-[#b84a00] text-sm font-semibold text-white">
          BC
        </div>
        <p className="mt-2 text-[17px] font-semibold">Bar do Cais</p>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] font-medium text-positive">
          <span className="size-1.5 rounded-full bg-positive" />
          Aberto até 23h30
        </p>
        <div className="mt-3 flex gap-4 border-b border-line text-[13px]">
          <span className="relative pb-2 font-semibold">
            Petiscos
            <span className="absolute inset-x-0 -bottom-px h-0.5 bg-[#b84a00]" />
          </span>
          <span className="pb-2 text-muted">Pratos</span>
          <span className="pb-2 text-muted">Bebidas</span>
        </div>
        <ul>
          {items.map((i) => (
            <li key={i.name} className={cn("border-b border-rule py-3 last:border-b-0", i.soldOut && "opacity-55")}>
              <p className="text-[14px] font-medium">{i.name}</p>
              <p className="line-clamp-1 text-[12px] text-muted">{i.desc}</p>
              <p className="num mt-1 text-[13px]">
                {i.soldOut ? (
                  <span className="rounded-full bg-pill-neutral-bg px-2 py-0.5 text-[11px] font-medium">Esgotado</span>
                ) : (
                  <>
                    {i.from && <span className="text-[11px] text-muted">a partir de </span>}
                    {formatMoney(i.price)}
                  </>
                )}
              </p>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-line p-3">
        <div className="flex h-11 items-center justify-between rounded-full bg-[#b84a00] px-4 text-[13px] font-medium text-white">
          <span>Ver sacola · 3 itens</span>
          <span className="num">{formatMoney(9800)}</span>
        </div>
      </div>
    </div>
  );
}

export function QueueFragment({ className }: { className?: string }) {
  // Agora = 20:30. Janela de 19:30 a 21:30.
  const rows = [
    { n: "#0187", who: "Mesa 4 · Em preparo", start: 30, end: 46, due: "20:43", left: "faltam 13 min" },
    { n: "#0188", who: "Entrega · Novo", start: 44, end: 86, due: "21:21", left: "faltam 51 min" },
    { n: "#0184", who: "Entrega · A caminho", start: 6, end: 47, due: "20:35", left: "faltam 5 min" },
    { n: "#0182", who: "Retirada · Pronto", start: 2, end: 27, due: "20:12", left: "atrasado 18 min", late: true },
  ];
  return (
    <div data-ui className={cn("rounded-card border border-line bg-surface p-5", className)} aria-hidden="true">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold">Fila agora</p>
        <p className="text-sm text-muted">4 pedidos abertos</p>
      </div>
      <div className="mt-3 grid grid-cols-[120px_1fr_88px] gap-3 pb-1 text-xs text-muted">
        <span>Pedido</span>
        <span className="relative">
          <span className="absolute left-0">19:30</span>
          <span className="absolute left-1/2 -translate-x-1/2 font-medium text-ink">agora</span>
          <span className="absolute right-0">21:30</span>
        </span>
        <span className="text-right">Prometido</span>
      </div>
      {rows.map((r) => (
        <div key={r.n} className="grid h-12 grid-cols-[120px_1fr_88px] items-center gap-3 border-t border-rule">
          <span>
            <span className="block font-mono text-[13px] font-medium">{r.n}</span>
            <span className="block truncate text-xs text-muted">{r.who}</span>
          </span>
          <span className="relative h-5">
            <span className="absolute inset-x-0 top-1/2 h-px bg-rule" />
            <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/35" style={{ left: `${r.start}%`, width: `${r.end - r.start}%` }} />
            {r.late && <span className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-negative" style={{ left: `${r.end}%`, width: `${50 - r.end}%` }} />}
            <span className="absolute top-0 left-1/2 h-full w-px bg-ink" />
          </span>
          <span className="text-right">
            <span className="num block text-sm">{r.due}</span>
            <span className={cn("block text-xs", r.late ? "font-medium text-negative" : "text-muted")}>{r.left}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function EditorFragment({ className }: { className?: string }) {
  const rows = [
    { name: "Batata frita", meta: "Tamanho, Adicionais", price: 2400, on: true },
    { name: "Isca de peixe", meta: "Sem opções", price: 4200, on: true },
    { name: "Torresmo de rolo", meta: "Sem opções", price: 3200, on: false },
  ];
  return (
    <div data-ui className={cn("rounded-card border border-line bg-surface", className)} aria-hidden="true">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <p className="text-base font-semibold">Petiscos</p>
        <p className="text-sm text-muted">5 itens</p>
      </div>
      {rows.map((r) => (
        <div key={r.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t border-rule px-4 py-3">
          <span>
            <span className="block text-sm font-medium">{r.name}</span>
            <span className="block text-[13px] text-muted">{r.meta}</span>
          </span>
          <span className="num text-sm">{formatMoney(r.price)}</span>
          <span className="flex items-center gap-2">
            <span className={cn("relative inline-flex h-5 w-9 items-center rounded-full", r.on ? "bg-positive" : "bg-control")}>
              <span className={cn("inline-block size-4 rounded-full bg-white", r.on ? "translate-x-[18px]" : "translate-x-0.5")} />
            </span>
            <span className={cn("w-[68px] text-xs", r.on ? "text-muted" : "font-medium text-negative")}>{r.on ? "Disponível" : "Esgotado"}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
