-- =====================================================================
-- Comanda · 007 · Cashback pelo WhatsApp do cliente
-- Rode DEPOIS do 006, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Regras:
--   · a loja liga o cashback e escolhe a porcentagem (1 a 30%) e a validade (7 a 365 dias);
--   · quando o pedido é concluído, o WhatsApp dele ganha a porcentagem do que pagou nos itens
--     (itens − cupom − cashback usado; a entrega não conta);
--   · no checkout o cliente vê o saldo e pode usar; o saldo abate do total;
--   · o saldo usado volta se o pedido for cancelado;
--   · o que vence primeiro é usado primeiro; o que venceu sai do saldo.

alter table public.stores add column if not exists cashback jsonb not null default '{"enabled": false, "rate": 5, "validDays": 60}'::jsonb;
alter table public.orders add column if not exists cashback_used integer not null default 0 check (cashback_used >= 0);

create table if not exists public.cashback_entries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{10,11}$'),
  order_id uuid references public.orders (id) on delete set null,
  kind text not null check (kind in ('earn', 'spend')),
  amount integer not null check (amount > 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  check (kind <> 'earn' or expires_at is not null)
);
create index if not exists cashback_store_phone_idx on public.cashback_entries (store_id, phone, created_at);
create unique index if not exists cashback_one_per_order on public.cashback_entries (order_id, kind) where order_id is not null;

alter table public.cashback_entries enable row level security;
grant select on public.cashback_entries to authenticated;
drop policy if exists "cashback: dono e gerente veem" on public.cashback_entries;
create policy "cashback: dono e gerente veem" on public.cashback_entries for select
  using (public.has_store_role(store_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------
-- Saldo: percorre os lançamentos em ordem; cada uso consome primeiro o ganho mais antigo
-- que ainda valia naquela hora; no fim soma o que ainda vale.
-- ---------------------------------------------------------------------

create or replace function public.cashback_balance_of(p_store uuid, p_phone text, p_at timestamptz default now())
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  e record;
  amounts integer[] := '{}';
  exps timestamptz[] := '{}';
  i integer;
  need integer;
  take integer;
  total integer := 0;
begin
  for e in
    select kind, amount, created_at, expires_at from public.cashback_entries
    where store_id = p_store and phone = p_phone and created_at <= p_at
    order by created_at, kind
  loop
    if e.kind = 'earn' then
      amounts := amounts || e.amount;
      exps := exps || e.expires_at;
    else
      need := e.amount;
      for i in 1 .. coalesce(array_length(amounts, 1), 0) loop
        exit when need = 0;
        if exps[i] > e.created_at and amounts[i] > 0 then
          take := least(amounts[i], need);
          amounts[i] := amounts[i] - take;
          need := need - take;
        end if;
      end loop;
    end if;
  end loop;
  for i in 1 .. coalesce(array_length(amounts, 1), 0) loop
    if exps[i] > p_at then
      total := total + amounts[i];
    end if;
  end loop;
  return total;
end;
$$;
revoke all on function public.cashback_balance_of(uuid, text, timestamptz) from public, anon, authenticated;

-- O que o checkout mostra: se a loja tem cashback, a porcentagem e o saldo daquele WhatsApp.
create or replace function public.cashback_info(p_store uuid, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.stores%rowtype;
  phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  select * into s from public.stores where id = p_store;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'enabled', coalesce((s.cashback ->> 'enabled')::boolean, false),
    'rate', coalesce((s.cashback ->> 'rate')::integer, 0),
    'balance', case when length(phone) between 10 and 11 then public.cashback_balance_of(s.id, phone) else 0 end
  );
end;
$$;
revoke all on function public.cashback_info(uuid, text) from public;
grant execute on function public.cashback_info(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Ganha ao concluir; devolve o usado ao cancelar.
-- ---------------------------------------------------------------------

create or replace function public.order_cashback()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.stores%rowtype;
  phone text := regexp_replace(coalesce(new.customer ->> 'phone', ''), '\D', '', 'g');
  amount integer;
begin
  if new.status = 'concluido' and old.status is distinct from 'concluido' and length(phone) between 10 and 11 then
    select * into s from public.stores where id = new.store_id;
    if coalesce((s.cashback ->> 'enabled')::boolean, false) then
      amount := round(greatest(new.subtotal - new.discount - new.cashback_used, 0)
                      * least(greatest(coalesce((s.cashback ->> 'rate')::integer, 0), 0), 30) / 100.0)::integer;
      if amount > 0 then
        insert into public.cashback_entries (store_id, phone, order_id, kind, amount, expires_at)
        values (new.store_id, phone, new.id, 'earn', amount,
                now() + make_interval(days => least(greatest(coalesce((s.cashback ->> 'validDays')::integer, 60), 7), 365)))
        on conflict do nothing;
      end if;
    end if;
  elsif new.status = 'cancelado' and old.status is distinct from 'cancelado' then
    delete from public.cashback_entries where order_id = new.id and kind = 'spend';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_cashback on public.orders;
create trigger orders_cashback
  after update of status on public.orders
  for each row execute function public.order_cashback();

-- ---------------------------------------------------------------------
-- place_order: igual ao 006, agora com payload.useCashback.
-- ---------------------------------------------------------------------

create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.stores%rowtype;
  new_order public.orders%rowtype;
  order_mode text := payload ->> 'mode';
  cust_name text := trim(coalesce(payload #>> '{customer,name}', ''));
  cust_phone text := regexp_replace(coalesce(payload #>> '{customer,phone}', ''), '\D', '', 'g');
  pay_method text := coalesce(payload #>> '{payment,method}', '');
  coupon_code text := nullif(upper(trim(coalesce(payload ->> 'couponCode', ''))), '');
  use_cashback boolean := coalesce((payload ->> 'useCashback')::boolean, false);
  coupon jsonb;
  change_for integer;
  table_no integer;
  region jsonb;
  built jsonb;
  subtotal integer;
  fee integer := 0;
  discount integer := 0;
  cashback integer := 0;
  eta integer := 25;
  total integer;
  num integer;
  delivery_out jsonb;
begin
  begin
    change_for := (payload #>> '{payment,changeFor}')::integer;
    table_no := (payload ->> 'tableNumber')::integer;
  exception when others then
    raise exception 'Dados do pedido inválidos.';
  end;

  select * into s from public.stores where id::text = payload ->> 'storeId' for update;
  if not found then
    raise exception 'Loja não encontrada.';
  end if;
  if not public.store_is_open(s) then
    raise exception 'A loja fechou enquanto você montava o pedido.';
  end if;
  if jsonb_typeof(payload -> 'lines') is distinct from 'array' or jsonb_array_length(payload -> 'lines') = 0 then
    raise exception 'A sacola está vazia.';
  end if;
  if cust_name = '' then
    raise exception 'Informe seu nome.';
  end if;
  if order_mode is null or order_mode not in ('delivery', 'pickup', 'table') then
    raise exception 'Escolha como quer receber o pedido.';
  end if;
  if order_mode <> 'table' and length(cust_phone) not between 10 and 11 then
    raise exception 'Informe um WhatsApp com DDD.';
  end if;
  if pay_method not in ('pix', 'card', 'cash') or coalesce((s.payment ->> pay_method)::boolean, false) = false then
    raise exception 'Esta forma de pagamento não está disponível.';
  end if;

  built := public.build_order_items(s.id, payload -> 'lines');
  subtotal := (built ->> 'subtotal')::integer;

  if order_mode = 'delivery' then
    if not coalesce((s.delivery ->> 'enabled')::boolean, false) then
      raise exception 'Esta loja não está entregando agora.';
    end if;
    select r into region
    from jsonb_array_elements(coalesce(s.delivery -> 'regions', '[]'::jsonb)) r
    where r ->> 'id' = payload #>> '{delivery,regionId}' and coalesce((r ->> 'active')::boolean, false);
    if region is null then
      raise exception 'Escolha um bairro atendido.';
    end if;
    if trim(coalesce(payload #>> '{delivery,street}', '')) = '' or trim(coalesce(payload #>> '{delivery,number}', '')) = '' then
      raise exception 'Informe rua e número.';
    end if;
    if subtotal < coalesce((s.delivery ->> 'minOrder')::integer, 0) then
      raise exception 'O pedido não chegou ao valor mínimo para entrega.';
    end if;
    fee := coalesce((region ->> 'fee')::integer, 0);
    eta := coalesce((s.delivery ->> 'etaMax')::integer, 50);
    delivery_out := jsonb_strip_nulls(jsonb_build_object(
      'regionId', region ->> 'id',
      'regionName', region ->> 'name',
      'street', left(trim(payload #>> '{delivery,street}'), 120),
      'number', left(trim(payload #>> '{delivery,number}'), 20),
      'complement', nullif(left(trim(coalesce(payload #>> '{delivery,complement}', '')), 120), ''),
      'reference', nullif(left(trim(coalesce(payload #>> '{delivery,reference}', '')), 120), '')));
  elsif order_mode = 'pickup' then
    if not coalesce((s.pickup ->> 'enabled')::boolean, false) then
      raise exception 'Esta loja não está com retirada agora.';
    end if;
    eta := coalesce((s.pickup ->> 'etaMax')::integer, 30);
  else
    if not coalesce((s.table_service ->> 'enabled')::boolean, false)
       or table_no is null or table_no < 1 or table_no > coalesce((s.table_service ->> 'count')::integer, 0) then
      raise exception 'Mesa inválida. Leia o QR code da mesa de novo.';
    end if;
  end if;

  -- A loja está travada (for update): cupom e saldo de cashback não estouram com pedidos ao mesmo tempo.
  if coupon_code is not null then
    coupon := public.coupon_discount(s.id, coupon_code, subtotal, fee, order_mode, cust_phone);
    discount := (coupon ->> 'discount')::integer;
  end if;

  if use_cashback then
    if not coalesce((s.cashback ->> 'enabled')::boolean, false) then
      raise exception 'Esta loja não está com cashback agora.';
    end if;
    if length(cust_phone) not between 10 and 11 then
      raise exception 'Informe seu WhatsApp para usar o cashback.';
    end if;
    cashback := least(public.cashback_balance_of(s.id, cust_phone), subtotal + fee - discount);
  end if;

  total := subtotal + fee - discount - cashback;
  if pay_method = 'cash' and change_for is not null and change_for < total then
    raise exception 'O troco precisa ser maior ou igual ao total do pedido.';
  end if;

  num := s.next_order_number;
  update public.stores set next_order_number = next_order_number + 1 where id = s.id;

  insert into public.orders (store_id, number, promised_at, status, history, mode, customer, delivery,
                             table_number, items, subtotal, delivery_fee, total, payment, notes, source,
                             discount, coupon_id, coupon_code, cashback_used)
  values (
    s.id, num, now() + make_interval(mins => eta), 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'at', now())),
    order_mode,
    jsonb_build_object('name', left(cust_name, 80), 'phone', cust_phone),
    delivery_out,
    case when order_mode = 'table' then table_no end,
    built -> 'items', subtotal, fee, total,
    case when pay_method = 'cash' and change_for is not null
         then jsonb_build_object('method', 'cash', 'changeFor', change_for)
         else jsonb_build_object('method', pay_method) end,
    nullif(left(trim(coalesce(payload ->> 'notes', '')), 200), ''),
    'cliente',
    discount, (coupon ->> 'couponId')::uuid, coupon ->> 'code', cashback
  )
  returning * into new_order;

  if cashback > 0 then
    insert into public.cashback_entries (store_id, phone, order_id, kind, amount)
    values (s.id, cust_phone, new_order.id, 'spend', cashback);
  end if;

  return to_jsonb(new_order);
end;
$$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- Conta da mesa: consumo já sem cupom e sem cashback usado.
create or replace function public.tab_total(p_tab uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select coalesce(sum(o.subtotal - o.discount - o.cashback_used), 0)::integer as consumption
    from public.orders o where o.tab_id = p_tab and o.status <> 'cancelado'
  )
  select c.consumption + case when t.service_fee_removed then 0
                              else round(c.consumption * t.service_fee_rate / 100.0)::integer end
  from public.tabs t, c where t.id = p_tab;
$$;
revoke all on function public.tab_total(uuid) from public, anon, authenticated;

-- Tempo real para a tela de cashback do painel.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'cashback_entries'
  ) then
    alter publication supabase_realtime add table public.cashback_entries;
  end if;
end;
$$;
