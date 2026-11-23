import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] leading-7 font-semibold tracking-[-0.01em]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] leading-6 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-card border border-line bg-surface", className)}>
      {(title || aside) && (
        <div className="flex min-h-12 items-center justify-between gap-3 px-5 pt-4 pb-2">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          {aside && <div className="text-sm text-muted">{aside}</div>}
        </div>
      )}
      <div className={cn("px-5 pb-5", !title && !aside && "pt-5", bodyClassName)}>{children}</div>
    </section>
  );
}
