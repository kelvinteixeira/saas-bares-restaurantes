-- =====================================================================
-- Comanda · 005 · Caixa: abrir e fechar o turno, receber pagamentos, sangria e suprimento
-- Rode DEPOIS do 004, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Regras:
--   · um caixa aberto por loja; sem caixa aberto não se recebe;
--   · a conta da mesa = consumo + taxa de serviço (se não foi tirada); recebe-se em partes,
--     em várias formas, até o que falta chegar a zero; aí a comanda fecha sozinha;
--   · no dinheiro, informa-se o valor entregue e o troco é calculado;
--   · pedido de balcão/entrega (fora de comanda) recebe do mesmo jeito, pelo pedido;
--   · fechamento: esperado em dinheiro = fundo + dinheiro recebido + suprimentos − sangrias;
--     a diferença é o contado menos o esperado.
-- Dinheiro em centavos.

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  opening_amount integer not null check (opening_amount >= 0),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  counted_amount integer check (counted_amount >= 0),
  expected_amount integer,
  notes text
);
create unique index if not exists cash_one_open_per_store on public.cash_sessions (store_id) where status = 'open';
create index if not exists cash_sessions_store_idx on public.cash_sessions (store_id, opened_at desc);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  cash_session_id uuid not null references public.cash_sessions (id) on delete cascade,
  tab_id uuid references public.tabs (id) on delete set null,
  order_id uuid references public.orders (id) on delete set null,
  method text not null check (method in ('pix', 'credit', 'debit', 'cash')),
  amount integer not null check (amount > 0),
  change_given integer not null default 0 check (change_given >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payments_session_idx on public.payments (cash_session_id);
create index if not exists payments_tab_idx on public.payments (tab_id);
create index if not exists payments_order_idx on public.payments (order_id);
create index if not exists payments_store_idx on public.payments (store_id, created_at desc);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  cash_session_id uuid not null references public.cash_sessions (id) on delete cascade,
  kind text not null check (kind in ('withdrawal', 'deposit')),
  amount integer not null check (amount > 0),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_session_idx on public.cash_movements (cash_session_id);

alter table public.cash_sessions enable row level security;
alter table public.payments enable row level security;
alter table public.cash_movements enable row level security;
grant select on public.cash_sessions, public.payments, public.cash_movements to authenticated;

-- Só quem mexe com dinheiro lê. Escrever, só pelas funções abaixo.
drop policy if exists "caixa: quem recebe lê" on public.cash_sessions;
create policy "caixa: quem recebe lê" on public.cash_sessions for select
  using (public.has_store_role(store_id, array['owner', 'manager', 'cashier']));
drop policy if exists "pagamentos: quem recebe lê" on public.payments;
create policy "pagamentos: quem recebe lê" on public.payments for select
  using (public.has_store_role(store_id, array['owner', 'manager', 'cashier']));
drop policy if exists "movimentos: quem recebe lê" on public.cash_movements;
create policy "movimentos: quem recebe lê" on public.cash_movements for select
  using (public.has_store_role(store_id, array['owner', 'manager', 'cashier']));

-- ---------------------------------------------------------------------
-- Contas
-- ---------------------------------------------------------------------

create or replace function public.brl(cents integer)
returns text
language sql
immutable
as $$
  -- 1234567 → "R$ 12.345,67" (sem depender do idioma do servidor).
  select 'R$ ' || translate(to_char(coalesce(cents, 0) / 100.0, 'FM999,999,990.00'), ',.', '.,');
$$;

-- Total da conta da mesa (consumo + taxa, se não foi tirada).
create or replace function public.tab_total(p_tab uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select coalesce(sum(o.subtotal), 0)::integer as consumption
    from public.orders o where o.tab_id = p_tab and o.status <> 'cancelado'
  )
  select c.consumption + case when t.service_fee_removed then 0
                              else round(c.consumption * t.service_fee_rate / 100.0)::integer end
  from public.tabs t, c where t.id = p_tab;
$$;

create or replace function public.tab_due(p_tab uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select public.tab_total(p_tab) - coalesce((select sum(amount) from public.payments where tab_id = p_tab), 0)::integer;
$$;

create or replace function public.order_due(p_order uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when o.status = 'cancelado' then 0 else o.total end
         - coalesce((select sum(amount) from public.payments where order_id = p_order), 0)::integer
  from public.orders o where o.id = p_order;
$$;

-- Dinheiro que deveria estar na gaveta agora.
create or replace function public.cash_expected(p_session uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select s.opening_amount
       + coalesce((select sum(amount) from public.payments where cash_session_id = s.id and method = 'cash'), 0)::integer
       + coalesce((select sum(amount) from public.cash_movements where cash_session_id = s.id and kind = 'deposit'), 0)::integer
       - coalesce((select sum(amount) from public.cash_movements where cash_session_id = s.id and kind = 'withdrawal'), 0)::integer
  from public.cash_sessions s where s.id = p_session;
$$;

-- Só as funções do banco usam (o app calcula os mesmos totais com os dados que já tem).
revoke all on function public.tab_total(uuid) from public, anon, authenticated;
revoke all on function public.tab_due(uuid) from public, anon, authenticated;
revoke all on function public.order_due(uuid) from public, anon, authenticated;
revoke all on function public.cash_expected(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Caixa
-- ---------------------------------------------------------------------

create or replace function public.open_cash(p_store uuid, p_opening integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.cash_sessions%rowtype;
begin
  if not public.has_store_role(p_store, array['owner', 'manager', 'cashier']) then
    raise exception 'Só o caixa, o gerente ou o dono abrem o caixa.';
  end if;
  if p_opening is null or p_opening < 0 or p_opening > 10000000 then
    raise exception 'Informe o fundo de troco (pode ser zero).';
  end if;
  if exists (select 1 from public.cash_sessions where store_id = p_store and status = 'open') then
    raise exception 'O caixa já está aberto.';
  end if;
  insert into public.cash_sessions (store_id, opened_by, opening_amount)
  values (p_store, auth.uid(), p_opening)
  returning * into s;
  return to_jsonb(s);
exception when unique_violation then
  raise exception 'O caixa já está aberto.';
end;
$$;

-- Sangria (withdrawal) ou suprimento (deposit) no caixa aberto.
create or replace function public.cash_movement(p_store uuid, p_kind text, p_amount integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.cash_sessions%rowtype;
  m public.cash_movements%rowtype;
begin
  if not public.has_store_role(p_store, array['owner', 'manager', 'cashier']) then
    raise exception 'Só o caixa, o gerente ou o dono mexem no caixa.';
  end if;
  select * into s from public.cash_sessions where store_id = p_store and status = 'open' for update;
  if not found then
    raise exception 'Abra o caixa primeiro.';
  end if;
  if p_kind not in ('withdrawal', 'deposit') then
    raise exception 'Escolha sangria ou suprimento.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Informe o valor.';
  end if;
  if trim(coalesce(p_reason, '')) = '' then
    raise exception 'Diga o motivo.';
  end if;
  if p_kind = 'withdrawal' and p_amount > public.cash_expected(s.id) then
    raise exception 'Não há % em dinheiro no caixa (tem %).', public.brl(p_amount), public.brl(public.cash_expected(s.id));
  end if;
  insert into public.cash_movements (store_id, cash_session_id, kind, amount, reason, created_by)
  values (p_store, s.id, p_kind, p_amount, left(trim(p_reason), 140), auth.uid())
  returning * into m;
  return to_jsonb(m);
end;
$$;

-- Fecha o turno: guarda o contado e o esperado.
create or replace function public.close_cash(p_store uuid, p_counted integer, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.cash_sessions%rowtype;
begin
  if not public.has_store_role(p_store, array['owner', 'manager', 'cashier']) then
    raise exception 'Só o caixa, o gerente ou o dono fecham o caixa.';
  end if;
  select * into s from public.cash_sessions where store_id = p_store and status = 'open' for update;
  if not found then
    raise exception 'O caixa já está fechado.';
  end if;
  if p_counted is null or p_counted < 0 then
    raise exception 'Informe quanto há em dinheiro na gaveta.';
  end if;
  update public.cash_sessions
  set status = 'closed', closed_by = auth.uid(), closed_at = now(), counted_amount = p_counted,
      expected_amount = public.cash_expected(s.id), notes = nullif(left(trim(coalesce(p_notes, '')), 300), '')
  where id = s.id
  returning * into s;
  return to_jsonb(s);
end;
$$;

-- ---------------------------------------------------------------------
-- Conta da mesa e recebimentos
-- ---------------------------------------------------------------------

-- Tira (ou devolve) a taxa de serviço da conta da mesa.
create or replace function public.set_tab_service_fee(p_tab uuid, p_removed boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
  paid integer;
begin
  select * into t from public.tabs where id = p_tab for update;
  if not found or not public.has_store_role(t.store_id, array['owner', 'manager', 'cashier']) then
    raise exception 'Comanda não encontrada.';
  end if;
  if t.status = 'closed' then
    raise exception 'Esta comanda já foi fechada.';
  end if;
  update public.tabs set service_fee_removed = coalesce(p_removed, false) where id = p_tab returning * into t;
  paid := coalesce((select sum(amount) from public.payments where tab_id = p_tab), 0);
  if paid > public.tab_total(p_tab) then
    raise exception 'Já foi recebido % e a conta sem a taxa fica em %.', public.brl(paid), public.brl(public.tab_total(p_tab));
  end if;
  return to_jsonb(t);
end;
$$;

-- Fecha a comanda: os pedidos ainda abertos viram "servido". Uso interno.
create or replace function public.finish_tab(p_tab uuid)
returns public.tabs
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
begin
  update public.orders
  set status = 'concluido',
      history = history || jsonb_build_array(jsonb_build_object('status', 'concluido', 'at', now()))
  where tab_id = p_tab and status not in ('concluido', 'cancelado');
  update public.tabs set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = p_tab returning * into t;
  return t;
end;
$$;
revoke all on function public.finish_tab(uuid) from public, anon, authenticated;

-- Recebe um pagamento da conta da mesa (tabId) ou de um pedido de balcão/entrega (orderId).
-- payload: {tabId | orderId, method: pix|credit|debit|cash, amount (cartão/Pix), received (dinheiro entregue)}
-- Devolve {payment, due, tabClosed}.
create or replace function public.register_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
  o public.orders%rowtype;
  s public.cash_sessions%rowtype;
  p public.payments%rowtype;
  store uuid;
  due integer;
  method text := payload ->> 'method';
  amount integer;
  received integer;
  change integer := 0;
  closed boolean := false;
begin
  begin
    amount := (payload ->> 'amount')::integer;
    received := (payload ->> 'received')::integer;
  exception when others then
    raise exception 'Valor inválido.';
  end;

  if payload ->> 'tabId' is not null then
    select * into t from public.tabs where id::text = payload ->> 'tabId' for update;
    if not found then
      raise exception 'Comanda não encontrada.';
    end if;
    if t.status = 'closed' then
      raise exception 'Esta comanda já foi fechada.';
    end if;
    store := t.store_id;
  elsif payload ->> 'orderId' is not null then
    select * into o from public.orders where id::text = payload ->> 'orderId' for update;
    if not found then
      raise exception 'Pedido não encontrado.';
    end if;
    if o.tab_id is not null then
      raise exception 'Este pedido é da mesa %: receba pela conta da mesa.', o.table_number;
    end if;
    store := o.store_id;
  else
    raise exception 'Diga o que está sendo pago.';
  end if;

  if not public.has_store_role(store, array['owner', 'manager', 'cashier']) then
    raise exception 'Só o caixa, o gerente ou o dono recebem.';
  end if;
  select * into s from public.cash_sessions where store_id = store and status = 'open';
  if not found then
    raise exception 'Abra o caixa antes de receber.';
  end if;

  due := case when t.id is not null then public.tab_due(t.id) else public.order_due(o.id) end;
  if due <= 0 then
    raise exception 'Esta conta já está paga.';
  end if;
  if method is null or method not in ('pix', 'credit', 'debit', 'cash') then
    raise exception 'Escolha a forma de pagamento.';
  end if;

  if method = 'cash' then
    if received is null or received <= 0 then
      raise exception 'Informe quanto o cliente entregou.';
    end if;
    amount := least(received, due);
    change := received - amount;
  else
    if amount is null or amount <= 0 then
      raise exception 'Informe o valor.';
    end if;
    if amount > due then
      raise exception 'O valor passa do que falta (%).', public.brl(due);
    end if;
  end if;

  insert into public.payments (store_id, cash_session_id, tab_id, order_id, method, amount, change_given, created_by)
  values (store, s.id, t.id, o.id, method, amount, change, auth.uid())
  returning * into p;

  due := due - amount;
  if t.id is not null and due = 0 then
    perform public.finish_tab(t.id);
    closed := true;
  end if;
  return jsonb_build_object('payment', to_jsonb(p), 'due', due, 'tabClosed', closed);
end;
$$;

-- close_tab do 003, agora conferindo que a conta foi paga (ou que não há nada a pagar).
create or replace function public.close_tab(p_tab uuid, p_remove_service_fee boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
  due integer;
begin
  select * into t from public.tabs where id = p_tab for update;
  if not found or not public.is_store_member(t.store_id) then
    raise exception 'Comanda não encontrada.';
  end if;
  if not public.has_store_role(t.store_id, array['owner', 'manager', 'cashier']) then
    raise exception 'Só o caixa, o gerente ou o dono fecham a conta.';
  end if;
  if t.status = 'closed' then
    raise exception 'Esta comanda já foi fechada.';
  end if;
  if coalesce(p_remove_service_fee, false) and not t.service_fee_removed then
    update public.tabs set service_fee_removed = true where id = p_tab;
  end if;
  due := public.tab_due(p_tab);
  if due > 0 then
    raise exception 'Ainda falta receber %. Registre os pagamentos para fechar.', public.brl(due);
  end if;
  t := public.finish_tab(p_tab);
  return to_jsonb(t);
end;
$$;

revoke all on function public.open_cash(uuid, integer) from public;
revoke all on function public.cash_movement(uuid, text, integer, text) from public;
revoke all on function public.close_cash(uuid, integer, text) from public;
revoke all on function public.set_tab_service_fee(uuid, boolean) from public;
revoke all on function public.register_payment(jsonb) from public;
revoke all on function public.close_tab(uuid, boolean) from public;
grant execute on function public.open_cash(uuid, integer) to authenticated;
grant execute on function public.cash_movement(uuid, text, integer, text) to authenticated;
grant execute on function public.close_cash(uuid, integer, text) to authenticated;
grant execute on function public.set_tab_service_fee(uuid, boolean) to authenticated;
grant execute on function public.register_payment(jsonb) to authenticated;
grant execute on function public.close_tab(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Tempo real: caixa e pagamentos aparecem em todos os aparelhos.
-- ---------------------------------------------------------------------

do $$
declare
  tbl text;
begin
  foreach tbl in array array['cash_sessions', 'payments', 'cash_movements'] loop
    if not exists (
      select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = tbl
    ) then
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    end if;
  end loop;
end;
$$;
