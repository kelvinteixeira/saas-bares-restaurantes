-- =====================================================================
-- Comanda · 003 · Comandas de mesa (app do garçom e pedido pelo QR na mesma conta)
-- Rode DEPOIS do 002, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Taxa de serviço da loja (10% opcional). A comanda guarda a taxa do momento em que abriu.
-- ---------------------------------------------------------------------

alter table public.stores add column if not exists service_fee jsonb not null default '{"enabled": true, "rate": 10}'::jsonb;

-- ---------------------------------------------------------------------
-- Comandas: uma aberta por mesa. Juntam os pedidos do garçom, do QR code e do PDV.
-- status: open (aberta) · bill_requested (pediu a conta) · closed (fechada)
-- ---------------------------------------------------------------------

create table if not exists public.tabs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  table_number integer not null check (table_number between 1 and 500),
  status text not null default 'open' check (status in ('open', 'bill_requested', 'closed')),
  opened_by uuid references auth.users (id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  service_fee_rate integer not null default 0 check (service_fee_rate between 0 and 30),
  service_fee_removed boolean not null default false,
  notes text
);

create unique index if not exists tabs_one_open_per_table on public.tabs (store_id, table_number) where status <> 'closed';
create index if not exists tabs_store_opened_idx on public.tabs (store_id, opened_at desc);

alter table public.orders add column if not exists tab_id uuid references public.tabs (id) on delete set null;
alter table public.orders add column if not exists source text not null default 'cliente';
alter table public.orders drop constraint if exists orders_source_check;
alter table public.orders add constraint orders_source_check check (source in ('cliente', 'garcom', 'pdv'));
alter table public.orders add column if not exists created_by uuid references auth.users (id) on delete set null;
create index if not exists orders_tab_idx on public.orders (tab_id);

alter table public.tabs enable row level security;
grant select on public.tabs to authenticated;

-- A equipe lê as comandas; abrir, lançar, pedir a conta, trocar de mesa e fechar só pelas funções abaixo.
drop policy if exists "comandas: equipe lê" on public.tabs;
create policy "comandas: equipe lê" on public.tabs for select using (public.is_store_member(store_id));

-- ---------------------------------------------------------------------
-- Pedido de mesa entra na comanda aberta da mesa (ou abre uma), venha de onde vier.
-- ---------------------------------------------------------------------

create or replace function public.attach_order_to_tab()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
  rate integer;
begin
  if new.tab_id is not null then
    select * into t from public.tabs where id = new.tab_id for update;
    if not found or t.store_id <> new.store_id or t.status = 'closed' then
      raise exception 'Esta comanda já foi fechada.';
    end if;
    new.mode := 'table';
    new.table_number := t.table_number;
  elsif new.mode = 'table' and new.table_number is not null then
    select * into t from public.tabs
    where store_id = new.store_id and table_number = new.table_number and status <> 'closed'
    for update;
    if not found then
      select case when coalesce((s.service_fee ->> 'enabled')::boolean, false)
                  then least(greatest(coalesce((s.service_fee ->> 'rate')::integer, 0), 0), 30) else 0 end
      into rate from public.stores s where s.id = new.store_id;
      insert into public.tabs (store_id, table_number, opened_by, service_fee_rate)
      values (new.store_id, new.table_number, auth.uid(), coalesce(rate, 0))
      returning * into t;
    end if;
    new.tab_id := t.id;
  else
    return new;
  end if;

  -- Pediu a conta e depois pediu mais: a comanda volta a ficar aberta.
  if t.status = 'bill_requested' then
    update public.tabs set status = 'open' where id = t.id;
  end if;
  return new;
end;
$$;

drop trigger if exists orders_attach_tab on public.orders;
create trigger orders_attach_tab
  before insert on public.orders
  for each row execute function public.attach_order_to_tab();

-- ---------------------------------------------------------------------
-- Itens do pedido conferidos e com preço do cardápio (nunca o preço da tela).
-- Usado por place_order e add_to_tab. Devolve {items, subtotal}.
-- lines: [{productId, selections:{groupId:[optionId]}, quantity, notes}]
-- ---------------------------------------------------------------------

create or replace function public.build_order_items(p_store uuid, p_lines jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  p public.products%rowtype;
  changed constant text := 'Um item da sacola mudou no cardápio. Remova e adicione de novo.';
  line jsonb;
  grp jsonb;
  opt jsonb;
  sel_group text;
  sel_ids jsonb;
  opt_id text;
  item_opts jsonb;
  items jsonb := '[]'::jsonb;
  qty integer;
  unit integer;
  chosen integer;
  subtotal integer := 0;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sacola está vazia.';
  end if;

  for line in select * from jsonb_array_elements(p_lines) loop
    select pr.* into p
    from public.products pr
    join public.categories c on c.id = pr.category_id
    where pr.id::text = line ->> 'productId' and pr.store_id = p_store and pr.available and c.visible;
    if not found then
      raise exception 'Um item da sacola não está mais disponível.';
    end if;

    -- Confere o formato antes de converter (o SQL não garante a ordem de um "or").
    if coalesce(line ->> 'quantity', '') !~ '^[0-9]{1,3}$' then
      raise exception 'Quantidade inválida em um item da sacola.';
    end if;
    qty := (line ->> 'quantity')::integer;
    if qty not between 1 and 50 then
      raise exception 'Quantidade inválida em um item da sacola.';
    end if;

    unit := p.price;
    item_opts := '[]'::jsonb;

    if jsonb_typeof(coalesce(line -> 'selections', '{}'::jsonb)) <> 'object' then
      raise exception '%', changed;
    end if;
    for sel_group, sel_ids in select key, value from jsonb_each(coalesce(line -> 'selections', '{}'::jsonb)) loop
      select g into grp from jsonb_array_elements(p.option_groups) g where g ->> 'id' = sel_group;
      if grp is null or jsonb_typeof(sel_ids) <> 'array' then
        raise exception '%', changed;
      end if;
      if jsonb_array_length(sel_ids) <> (select count(distinct v) from jsonb_array_elements_text(sel_ids) v) then
        raise exception '%', changed;
      end if;
      for opt_id in select jsonb_array_elements_text(sel_ids) loop
        select o into opt from jsonb_array_elements(grp -> 'options') o where o ->> 'id' = opt_id;
        if opt is null then
          raise exception '%', changed;
        end if;
        if not coalesce((opt ->> 'available')::boolean, false) then
          raise exception 'A opção "%" de % acabou.', opt ->> 'name', p.name;
        end if;
        unit := unit + (opt ->> 'price')::integer;
        item_opts := item_opts || jsonb_build_array(jsonb_build_object(
          'groupName', grp ->> 'name', 'optionName', opt ->> 'name', 'price', (opt ->> 'price')::integer));
      end loop;
    end loop;

    for grp in select * from jsonb_array_elements(p.option_groups) loop
      chosen := coalesce(jsonb_array_length(line -> 'selections' -> (grp ->> 'id')), 0);
      if chosen < (grp ->> 'min')::integer or chosen > (grp ->> 'max')::integer then
        raise exception '%', changed;
      end if;
    end loop;

    subtotal := subtotal + unit * qty;
    items := items || jsonb_build_array(
      jsonb_build_object('productId', p.id, 'name', p.name, 'unitPrice', unit, 'quantity', qty, 'options', item_opts)
      || case when coalesce(trim(line ->> 'notes'), '') <> ''
              then jsonb_build_object('notes', left(trim(line ->> 'notes'), 140))
              else '{}'::jsonb end);
  end loop;

  return jsonb_build_object('items', items, 'subtotal', subtotal);
end;
$$;

-- Só as funções do banco chamam (elas rodam como dono do banco).
revoke all on function public.build_order_items(uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- place_order: as mesmas regras do 001, agora com os itens conferidos por build_order_items.
-- O pedido de mesa entra na comanda pelo trigger acima.
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
  change_for integer;
  table_no integer;
  region jsonb;
  built jsonb;
  subtotal integer;
  fee integer := 0;
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

  total := subtotal + fee;
  if pay_method = 'cash' and change_for is not null and change_for < total then
    raise exception 'O troco precisa ser maior ou igual ao total do pedido.';
  end if;

  num := s.next_order_number;
  update public.stores set next_order_number = next_order_number + 1 where id = s.id;

  insert into public.orders (store_id, number, promised_at, status, history, mode, customer, delivery,
                             table_number, items, subtotal, delivery_fee, total, payment, notes, source)
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
    'cliente'
  )
  returning * into new_order;

  return to_jsonb(new_order);
end;
$$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Funções da comanda (equipe do salão).
-- ---------------------------------------------------------------------

-- Abre a comanda da mesa. Se já houver uma aberta (outro garçom abriu), devolve essa.
create or replace function public.open_tab(p_store uuid, p_table integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.stores%rowtype;
  t public.tabs%rowtype;
begin
  if not public.has_store_role(p_store, array['owner', 'manager', 'cashier', 'waiter']) then
    raise exception 'Só a equipe do salão pode abrir mesa.';
  end if;
  select * into s from public.stores where id = p_store;
  if p_table is null or p_table < 1 or p_table > coalesce((s.table_service ->> 'count')::integer, 0) then
    raise exception 'Mesa % não existe. Confira o número de mesas nas configurações.', coalesce(p_table::text, '');
  end if;

  select * into t from public.tabs where store_id = p_store and table_number = p_table and status <> 'closed';
  if found then
    return to_jsonb(t);
  end if;

  insert into public.tabs (store_id, table_number, opened_by, service_fee_rate)
  values (
    p_store, p_table, auth.uid(),
    case when coalesce((s.service_fee ->> 'enabled')::boolean, false)
         then least(greatest(coalesce((s.service_fee ->> 'rate')::integer, 0), 0), 30) else 0 end)
  on conflict do nothing
  returning * into t;
  -- Dois garçons abrindo a mesma mesa ao mesmo tempo: fica a que entrou primeiro.
  if t.id is null then
    select * into t from public.tabs where store_id = p_store and table_number = p_table and status <> 'closed';
  end if;
  return to_jsonb(t);
end;
$$;

-- Lança itens na comanda: vira um pedido que vai para a tela de preparo e para a fila do painel.
create or replace function public.add_to_tab(p_tab uuid, p_lines jsonb, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
  s public.stores%rowtype;
  built jsonb;
  num integer;
  new_order public.orders%rowtype;
begin
  select * into t from public.tabs where id = p_tab;
  if not found or not public.has_store_role(t.store_id, array['owner', 'manager', 'cashier', 'waiter']) then
    raise exception 'Comanda não encontrada.';
  end if;
  if t.status = 'closed' then
    raise exception 'Esta comanda já foi fechada.';
  end if;

  select * into s from public.stores where id = t.store_id for update;
  built := public.build_order_items(s.id, p_lines);
  num := s.next_order_number;
  update public.stores set next_order_number = next_order_number + 1 where id = s.id;

  insert into public.orders (store_id, number, promised_at, status, history, mode, customer, table_number, items,
                             subtotal, delivery_fee, total, payment, notes, tab_id, source, created_by)
  values (
    s.id, num, now() + interval '25 minutes', 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'at', now())),
    'table',
    jsonb_build_object('name', 'Mesa ' || t.table_number, 'phone', ''),
    t.table_number,
    built -> 'items',
    (built ->> 'subtotal')::integer, 0, (built ->> 'subtotal')::integer,
    jsonb_build_object('method', 'tab'),
    nullif(left(trim(coalesce(p_notes, '')), 200), ''),
    t.id, 'garcom', auth.uid()
  )
  returning * into new_order;

  return to_jsonb(new_order);
end;
$$;

-- Pedir a conta (ou desfazer, com p_requested = false).
create or replace function public.request_bill(p_tab uuid, p_requested boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
begin
  select * into t from public.tabs where id = p_tab;
  if not found or not public.has_store_role(t.store_id, array['owner', 'manager', 'cashier', 'waiter']) then
    raise exception 'Comanda não encontrada.';
  end if;
  if t.status = 'closed' then
    raise exception 'Esta comanda já foi fechada.';
  end if;
  update public.tabs set status = case when p_requested then 'bill_requested' else 'open' end
  where id = p_tab returning * into t;
  return to_jsonb(t);
end;
$$;

-- Leva a comanda (e os pedidos dela) para outra mesa, que precisa estar livre.
create or replace function public.transfer_tab(p_tab uuid, p_table integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
  s public.stores%rowtype;
begin
  select * into t from public.tabs where id = p_tab for update;
  if not found or not public.has_store_role(t.store_id, array['owner', 'manager', 'cashier', 'waiter']) then
    raise exception 'Comanda não encontrada.';
  end if;
  if t.status = 'closed' then
    raise exception 'Esta comanda já foi fechada.';
  end if;
  select * into s from public.stores where id = t.store_id;
  if p_table is null or p_table < 1 or p_table > coalesce((s.table_service ->> 'count')::integer, 0) then
    raise exception 'Mesa % não existe.', coalesce(p_table::text, '');
  end if;
  if p_table = t.table_number then
    return to_jsonb(t);
  end if;
  if exists (select 1 from public.tabs where store_id = t.store_id and table_number = p_table and status <> 'closed') then
    raise exception 'A mesa % já está ocupada.', p_table;
  end if;

  update public.tabs set table_number = p_table where id = p_tab returning * into t;
  update public.orders set table_number = p_table, customer = jsonb_set(customer, '{name}', to_jsonb('Mesa ' || p_table))
  where tab_id = p_tab and source = 'garcom';
  update public.orders set table_number = p_table where tab_id = p_tab and source <> 'garcom';
  return to_jsonb(t);
end;
$$;

-- Fecha a conta: os pedidos ainda abertos da mesa viram "servido" e a mesa fica livre.
-- (O registro dos pagamentos entra com o caixa, no próximo passo.)
create or replace function public.close_tab(p_tab uuid, p_remove_service_fee boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.tabs%rowtype;
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

  update public.orders
  set status = 'concluido',
      history = history || jsonb_build_array(jsonb_build_object('status', 'concluido', 'at', now()))
  where tab_id = p_tab and status not in ('concluido', 'cancelado');

  update public.tabs
  set status = 'closed', closed_at = now(), closed_by = auth.uid(), service_fee_removed = coalesce(p_remove_service_fee, false)
  where id = p_tab
  returning * into t;
  return to_jsonb(t);
end;
$$;

revoke all on function public.open_tab(uuid, integer) from public;
revoke all on function public.add_to_tab(uuid, jsonb, text) from public;
revoke all on function public.request_bill(uuid, boolean) from public;
revoke all on function public.transfer_tab(uuid, integer) from public;
revoke all on function public.close_tab(uuid, boolean) from public;
grant execute on function public.open_tab(uuid, integer) to authenticated;
grant execute on function public.add_to_tab(uuid, jsonb, text) to authenticated;
grant execute on function public.request_bill(uuid, boolean) to authenticated;
grant execute on function public.transfer_tab(uuid, integer) to authenticated;
grant execute on function public.close_tab(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Tempo real: o mapa de mesas acompanha as comandas.
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tabs'
  ) then
    alter publication supabase_realtime add table public.tabs;
  end if;
end;
$$;
