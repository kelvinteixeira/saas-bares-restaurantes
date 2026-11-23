import { cn } from "@/lib/cn";

/** Uma linha de configurações: título e explicação à esquerda, painel à direita. */
export function SettingsSection({
  title,
  description,
  children,
  aside,
  id,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="grid gap-4 border-t border-line py-8 first:border-t-0 first:pt-2 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] lg:gap-10">
      <div className="lg:pt-2">
        <h2 className="text-base font-medium">{title}</h2>
        <div className="mt-1 text-sm leading-6 text-muted">{description}</div>
        {aside && <div className="mt-4">{aside}</div>}
      </div>
      <div className="rounded-[16px] bg-raised p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function SaveBar({
  dirty,
  onSave,
  onReset,
  className,
}: {
  dirty: boolean;
  onSave: () => void;
  onReset: () => void;
  className?: string;
}) {
  return (
    <div className={cn("mt-5 flex items-center justify-end gap-3", className)}>
      {dirty && <span className="mr-auto text-xs text-warning">Alterações não salvas</span>}
      {dirty && (
        <button type="button" onClick={onReset} className="h-9 px-2 text-sm text-muted hover:text-ink">
          Desfazer
        </button>
      )}
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty}
        className="h-9 rounded-control bg-accent px-4 text-sm font-medium text-white hover:bg-accent-hover disabled:bg-control disabled:text-[#3a3b3b]"
      >
        Salvar
      </button>
    </div>
  );
}
