import { cn } from "@/lib/cn";

type Tone = "neutral" | "positive" | "negative" | "warning" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-pill-neutral-bg text-pill-neutral-ink",
  positive: "bg-pill-positive-bg text-pill-positive-ink",
  negative: "bg-pill-negative-bg text-pill-negative-ink",
  warning: "bg-pill-warning-bg text-pill-warning-ink",
  accent: "bg-accent-soft text-accent",
};

export function Pill({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 flex-none items-center whitespace-nowrap rounded-full px-2 text-xs font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
