import { formatMoney } from "@/lib/format";

/** Uma comanda de exemplo, desenhada como o painel mostra: o que o dono vai receber. */
export function OrderTicketPreview({ compact = false }: { compact?: boolean }) {
  const items = [
    { q: 2, name: "Cerveja long neck", detail: "Heineken", price: 2600 },
    { q: 1, name: "Batata frita", detail: "Porção inteira · Cheddar", price: 4400 },
    { q: 1, name: "Isca de peixe", detail: "", price: 4200 },
  ];
  const subtotal = items.reduce((s, i) => s + i.price, 0);
  return (
    <div data-ui className="max-w-[360px]">
      {!compact && (
        <p className="text-[15px] leading-6 text-ink">
          Cada pedido chega no painel como uma comanda: quem pediu, para onde vai, o que levar e quanto falta para o
          horário prometido.
        </p>
      )}
      <div className={compact ? "rounded-card bg-surface" : "mt-6 rounded-card border border-line bg-surface"}>
        <div className="flex items-center justify-between px-4 pt-4">
          <span className="font-mono text-[15px] font-medium">#0142</span>
          <span className="rounded-full bg-pill-warning-bg px-2 text-xs leading-5 font-medium text-pill-warning-ink">
            Novo · há 2 min
          </span>
        </div>
        <p className="px-4 pt-1 text-[13px] text-muted">Mesa 7 · Larissa M.</p>
        <ul className="mt-3 border-t border-rule px-4 py-3">
          {items.map((i) => (
            <li key={i.name} className="flex justify-between gap-3 py-1.5">
              <span>
                <span className="num font-medium">{i.q}×</span> {i.name}
                {i.detail && <span className="block text-xs text-muted">{i.detail}</span>}
              </span>
              <span className="num text-right">{formatMoney(i.price)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between border-t border-rule px-4 py-3 font-medium">
          <span>Total</span>
          <span className="num">{formatMoney(subtotal)}</span>
        </div>
      </div>
    </div>
  );
}
