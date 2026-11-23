import type { Store } from "@/lib/types";
import { readableInk } from "@/lib/color";
import { cn } from "@/lib/cn";

/** Aplica a cor da marca da loja como variáveis CSS para os filhos. */
export function BrandScope({ store, children, className }: { store: Store; children: React.ReactNode; className?: string }) {
  const style = { "--brand": store.brandColor, "--brand-ink": readableInk(store.brandColor) } as React.CSSProperties;
  return (
    <div style={style} className={cn("min-h-dvh bg-surface", className)}>
      {children}
    </div>
  );
}

export function brandButton(className?: string) {
  return cn(
    "inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[var(--brand)] px-5 text-[15px] font-medium text-[var(--brand-ink)] transition-[filter] hover:brightness-110 active:brightness-95 disabled:cursor-not-allowed disabled:bg-control disabled:text-[#3a3b3b] disabled:hover:brightness-100",
    className,
  );
}

export function StoreLogo({ store, size = 64, className }: { store: Store; size?: number; className?: string }) {
  if (store.logo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={store.logo}
        alt={`Logo de ${store.name}`}
        width={size}
        height={size}
        className={cn("flex-none rounded-full border-4 border-surface bg-surface object-cover", className)}
      />
    );
  }
  const initials = store.name
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || store.name.slice(0, 1).toUpperCase();
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, background: "var(--brand)", color: "var(--brand-ink)" }}
      className={cn("grid flex-none place-items-center rounded-full border-4 border-surface text-lg font-semibold", className)}
    >
      {initials}
    </span>
  );
}
