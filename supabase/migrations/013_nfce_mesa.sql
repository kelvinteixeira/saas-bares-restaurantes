-- =====================================================================
-- Comanda · 013 · NFC-e da comanda da mesa
-- Rode DEPOIS do 012, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Regras:
--   · a nota da mesa sai da comanda inteira (todos os pedidos não cancelados), depois que ela
--     fecha e está paga; a taxa de serviço entra como outras despesas;
--   · uma comanda tem no máximo uma nota em processamento ou autorizada;
--   · como no 012, só o servidor (service_role) grava; a equipe do caixa lê.

alter table public.fiscal_documents add column if not exists tab_id uuid references public.tabs (id) on delete set null;
create unique index if not exists fiscal_documents_active_tab_idx on public.fiscal_documents (tab_id)
  where status in ('processing', 'authorized');
create index if not exists fiscal_documents_tab_idx on public.fiscal_documents (tab_id) where tab_id is not null;
