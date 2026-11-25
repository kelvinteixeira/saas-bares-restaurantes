-- =====================================================================
-- Comanda · 012 · NFC-e (nota fiscal de consumidor)
-- Rode DEPOIS do 011, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Regras:
--   · dono e gerente informam os dados fiscais da loja (CNPJ, inscrição estadual, razão social,
--     regime e os códigos padrão dos itens); o caixa lê, para saber se emite;
--   · cada item pode ter NCM, CFOP e CSOSN/CST próprios (senão vale o padrão da loja);
--   · certificado A1 e CSC NÃO ficam aqui: vão direto para o emissor fiscal quando ele for ligado;
--   · as notas (fiscal_documents) só são gravadas pelo servidor da Comanda, depois da resposta
--     do emissor. A equipe (dono, gerente e caixa) só lê;
--   · um pedido tem no máximo uma nota em processamento ou autorizada.

create table if not exists public.store_fiscal (
  store_id uuid primary key references public.stores (id) on delete cascade,
  enabled boolean not null default false,
  environment text not null default 'homologacao' check (environment in ('homologacao', 'producao')),
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'),
  ie text not null check (ie ~ '^[0-9]{2,14}$'),
  legal_name text not null check (length(trim(legal_name)) between 2 and 120),
  regime text not null default 'simples' check (regime in ('simples', 'simples_excesso', 'normal')),
  default_ncm text not null default '21069090' check (default_ncm ~ '^[0-9]{8}$'),
  default_cfop text not null default '5102' check (default_cfop ~ '^[0-9]{4}$'),
  -- CSOSN (Simples) ou CST do ICMS (regime normal).
  default_tax_code text not null default '102' check (default_tax_code ~ '^[0-9]{2,3}$'),
  -- Preenchidos pelo servidor quando a loja for cadastrada no emissor.
  provider_company_id text,
  certificate_valid_until date,
  updated_at timestamptz not null default now()
);

alter table public.store_fiscal enable row level security;
grant select, insert, update on public.store_fiscal to authenticated;
-- O servidor (chave secreta, papel service_role) grava o cadastro no emissor.
grant select, update on public.store_fiscal to service_role;

drop policy if exists "fiscal: equipe do caixa lê" on public.store_fiscal;
create policy "fiscal: equipe do caixa lê" on public.store_fiscal for select
  using (public.has_store_role(store_id, array['owner', 'manager', 'cashier']));
drop policy if exists "fiscal: dono e gerente criam" on public.store_fiscal;
create policy "fiscal: dono e gerente criam" on public.store_fiscal for insert
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "fiscal: dono e gerente alteram" on public.store_fiscal;
create policy "fiscal: dono e gerente alteram" on public.store_fiscal for update
  using (public.has_store_role(store_id, array['owner', 'manager']))
  with check (public.has_store_role(store_id, array['owner', 'manager']));

-- A loja não escolhe o que só o servidor sabe (cadastro no emissor e validade do certificado).
create or replace function public.store_fiscal_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.provider_company_id := null;
      new.certificate_valid_until := null;
    else
      new.provider_company_id := old.provider_company_id;
      new.certificate_valid_until := old.certificate_valid_until;
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists store_fiscal_guard on public.store_fiscal;
create trigger store_fiscal_guard before insert or update on public.store_fiscal
  for each row execute function public.store_fiscal_guard();

-- Códigos fiscais por item: {"ncm": "22021000", "cfop": "5405", "taxCode": "500"} (todos opcionais).
alter table public.products add column if not exists fiscal jsonb;
alter table public.products drop constraint if exists products_fiscal_check;
alter table public.products add constraint products_fiscal_check check (
  fiscal is null or (
    jsonb_typeof(fiscal) = 'object'
    and (not (fiscal ? 'ncm') or (fiscal ->> 'ncm') ~ '^[0-9]{8}$')
    and (not (fiscal ? 'cfop') or (fiscal ->> 'cfop') ~ '^[0-9]{4}$')
    and (not (fiscal ? 'taxCode') or (fiscal ->> 'taxCode') ~ '^[0-9]{2,3}$')
  )
);

create table if not exists public.fiscal_documents (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  kind text not null default 'nfce' check (kind = 'nfce'),
  environment text not null check (environment in ('homologacao', 'producao')),
  provider text not null check (length(provider) between 1 and 40),
  status text not null check (status in ('processing', 'authorized', 'rejected', 'cancelled', 'error')),
  number integer,
  series integer,
  access_key text check (access_key is null or access_key ~ '^[0-9]{44}$'),
  protocol text,
  total integer not null check (total >= 0),
  cpf text check (cpf is null or cpf ~ '^[0-9]{11}$'),
  danfe_url text,
  xml_url text,
  message text,
  provider_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz
);
create index if not exists fiscal_documents_store_idx on public.fiscal_documents (store_id, created_at desc);
create unique index if not exists fiscal_documents_active_idx on public.fiscal_documents (order_id)
  where status in ('processing', 'authorized');

alter table public.fiscal_documents enable row level security;
grant select on public.fiscal_documents to authenticated;
-- Só o servidor (service_role) grava as notas.
grant select, insert, update on public.fiscal_documents to service_role;

drop policy if exists "notas: equipe do caixa lê" on public.fiscal_documents;
create policy "notas: equipe do caixa lê" on public.fiscal_documents for select
  using (public.has_store_role(store_id, array['owner', 'manager', 'cashier']));

-- Tempo real: a nota aparece no pedido assim que o servidor grava a resposta do emissor.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fiscal_documents'
  ) then
    alter publication supabase_realtime add table public.fiscal_documents;
  end if;
end;
$$;
