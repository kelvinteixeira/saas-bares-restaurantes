import { cn } from "@/lib/cn";

/** Marca do produto: uma comanda com a borda picotada. */
export function ComandaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 24" aria-hidden="true" className={cn("h-6 w-5 flex-none", className)}>
      <path
        d="M2 1.5h16a.5.5 0 0 1 .5.5v19.2l-2.1-1.4-2.1 1.4-2.1-1.4-2.2 1.4-2.1-1.4-2.1 1.4-2.1-1.4-1.6 1.1V2a.5.5 0 0 1 .5-.5Z"
        fill="#eb5f00"
      />
      <path d="M5 7h10M5 10.5h10M5 14h6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] text-ink", className)}>
      <ComandaMark />
      Comanda
    </span>
  );
}
