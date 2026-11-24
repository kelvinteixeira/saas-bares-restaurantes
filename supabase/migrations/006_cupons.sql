-- =====================================================================
-- Comanda · 006 · Cupons de desconto no cardápio
-- Rode DEPOIS do 005, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Tipos: percent (porcentagem dos itens), fixed (valor fixo, até o valor dos itens) e
-- free_delivery (zera a taxa de entrega). Regras: ativo, dentro das datas, pedido mínimo
-- (sobre os itens), limite de usos e "uma vez por cliente" (pelo WhatsApp).
-- O desconto vale nos pedidos do cardápio (place_order); o banco confere de novo ao fechar.

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9]{3,20}$'),
  kind text not null check (kind in ('percent', 'fixed', 'free_delivery')),
  value integer not null default 0 check (value >= 0),
  min_order integer not null default 0 check (min_order >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  once_per_customer boolean not null default false,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind <> 'percent' or value between 1 and 100),
  check (kind <> 'fixed' or value > 0),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create unique index if not exists coupons_store_code on public.coupons (store_id, code);

alter table public.orders add column if not exists discount integer not null default 0 check (discount >= 0);
alter table public.orders add column if not exists coupon_id uuid references public.coupons (id) on delete set null;
alter table public.orders add column if not exists coupon_code text;
create index if not exists orders_coupon_idx on public.orders (coupon_id);

alter table public.coupons enable row level security;
grant select, insert, update, delete on public.coupons to authenticated;

drop policy if exists "cupons: dono e gerente veem" on public.coupons;
create policy "cupons: dono e gerente veem" on public.coupons for select
  using (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "cupons: dono e gerente criam" on public.coupons;
create policy "cupons: dono e gerente criam" on public.coupons for insert
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "cupons: dono e gerente alteram" on public.coupons;
create policy "cupons: dono e gerente alteram" on public.coupons for update
  using (public.has_store_role(store_id, array['owner', 'manager']))
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "cupons: dono e gerente apagam" on public.coupons;
create policy "cupons: dono e gerente apagam" on public.coupons for delete
  using (public.has_store_role(store_id, array['owner', 'manager']));

-- ---------------------------------------------------------------------
-- Confere o cupom e calcula o desconto. Devolve {couponId, code, kind, discount}.
-- Uso interno (place_order) e pela prévia do checkout (check_coupon).
-- ---------------------------------------------------------------------

create or replace function public.coupon_discount(p_store uuid, p_code text, p_subtotal integer, p_fee integer, p_mode text, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.coupons%rowtype;
  phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  used integer;
  discount integer;
begin
  select * into c from public.coupons where store_id = p_store and code = upper(trim(coalesce(p_code, '')));
  if not found or not c.active then
    raise exception 'Cupom inválido.';
  end if;
  if c.starts_at is not null and now() < c.starts_at then
    raise exception 'Este cupom ainda não começou.';
  end if;
  if c.ends_at is not null and now() >= c.ends_at then
    raise exception 'Este cupom venceu.';
  end if;
  if coalesce(p_subtotal, 0) < c.min_order then
    raise exception 'Este cupom vale para pedidos a partir de %.', public.brl(c.min_order);
  end if;
  if c.max_uses is not null then
    select count(*) into used from public.orders where coupon_id = c.id and status <> 'cancelado';
    if used >= c.max_uses then
      raise exception 'Este cupom esgotou.';
    end if;
  end if;
  if c.once_per_customer then
    if phone = '' then
      raise exception 'Informe seu WhatsApp para usar este cupom.';
    end if;
    if exists (select 1 from public.orders
               where coupon_id = c.id and status <> 'cancelado' and customer ->> 'phone' = phone) then
      raise exception 'Você já usou este cupom.';
    end if;
  end if;

  if c.kind = 'free_delivery' then
    if p_mode <> 'delivery' then
      raise exception 'Este cupom é de entrega grátis.';
    end if;
    discount := coalesce(p_fee, 0);
  elsif c.kind = 'percent' then
    discount := round(coalesce(p_subtotal, 0) * c.value / 100.0)::integer;
  else
    discount := least(c.value, coalesce(p_subtotal, 0));
  end if;

  return jsonb_build_object('couponId', c.id, 'code', c.code, 'kind', c.kind, 'discount', discount);
end;
$$;
revoke all on function public.coupon_discount(uuid, text, integer, integer, text, text) from public, anon, authenticated;

-- Prévia no checkout (o cliente não lê a tabela de cupons). O valor final é conferido no place_order.
create or replace function public.check_coupon(p_store uuid, p_code text, p_subtotal integer, p_fee integer, p_mode text, p_phone text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.coupon_discount(p_store, p_code, p_subtotal, p_fee, p_mode, p_phone);
$$;
revoke all on function public.check_coupon(uuid, text, integer, integer, text, text) from public;
grant execute on function public.check_coupon(uuid, text, integer, integer, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- place_order: igual ao 003, agora com o cupom (payload.couponCode).
-- Pedido mínimo de entrega continua sobre os itens, antes do desconto.
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
  coupon jsonb;
  change_for integer;
  table_no integer;
  region jsonb;
  built jsonb;
  subtotal integer;
  fee integer := 0;
  discount integer := 0;
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

  -- A loja está travada (for update): o limite de usos do cupom não estoura com pedidos ao mesmo tempo.
  if coupon_code is not null then
    coupon := public.coupon_discount(s.id, coupon_code, subtotal, fee, order_mode, cust_phone);
    discount := (coupon ->> 'discount')::integer;
  end if;

  total := subtotal + fee - discount;
  if pay_method = 'cash' and change_for is not null and change_for < total then
    raise exception 'O troco precisa ser maior ou igual ao total do pedido.';
  end if;

  num := s.next_order_number;
  update public.stores set next_order_number = next_order_number + 1 where id = s.id;

  insert into public.orders (store_id, number, promised_at, status, history, mode, customer, delivery,
                             table_number, items, subtotal, delivery_fee, total, payment, notes, source,
                             discount, coupon_id, coupon_code)
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
    discount, (coupon ->> 'couponId')::uuid, coupon ->> 'code'
  )
  returning * into new_order;

  return to_jsonb(new_order);
end;
$$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- A conta da mesa passa a somar o consumo já com o desconto dos pedidos (total − entrega).
-- ---------------------------------------------------------------------

create or replace function public.tab_total(p_tab uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  with c as (
    select coalesce(sum(o.subtotal - o.discount), 0)::integer as consumption
    from public.orders o where o.tab_id = p_tab and o.status <> 'cancelado'
  )
  select c.consumption + case when t.service_fee_removed then 0
                              else round(c.consumption * t.service_fee_rate / 100.0)::integer end
  from public.tabs t, c where t.id = p_tab;
$$;
revoke all on function public.tab_total(uuid) from public, anon, authenticated;
