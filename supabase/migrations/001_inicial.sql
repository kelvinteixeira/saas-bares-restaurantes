-- =====================================================================
-- Comanda — esquema inicial (fase 2)
-- Rodar inteiro no SQL Editor do Supabase. Pode rodar de novo: tabelas e
-- funções usam "if not exists" / "or replace" e as políticas são recriadas.
--
-- Espelha os tipos de src/lib/types.ts. Dinheiro sempre em centavos (integer).
-- Equipe com login próprio por função (store_members): dono, gerente, caixa, garçom e cozinha.
-- Pedidos só nascem pela função place_order, que confere tudo no banco
-- (preço, opções, horário, bairro, pagamento) e numera em sequência por loja.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users (id) on delete cascade,
  slug text not null unique
    check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38})[a-z0-9]$'),
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  phone text not null default '',
  address jsonb not null default '{"street":"","number":"","district":"","city":"","state":""}'::jsonb,
  brand_color text not null default '#b84a00' check (brand_color ~ '^#[0-9a-fA-F]{6}$'),
  logo_url text,
  timezone text not null default 'America/Sao_Paulo',
  -- Chaves "0".."6" (0 = domingo); cada dia é uma lista de {open, close} em "HH:mm".
  hours jsonb not null default '{
    "0":[{"open":"11:00","close":"23:00"}],
    "1":[{"open":"11:00","close":"23:00"}],
    "2":[{"open":"11:00","close":"23:00"}],
    "3":[{"open":"11:00","close":"23:00"}],
    "4":[{"open":"11:00","close":"23:00"}],
    "5":[{"open":"11:00","close":"23:00"}],
    "6":[{"open":"11:00","close":"23:00"}]
  }'::jsonb,
  manual_status text not null default 'auto' check (manual_status in ('auto', 'open', 'closed')),
  delivery jsonb not null default '{"enabled":false,"minOrder":0,"etaMin":30,"etaMax":50,"regions":[]}'::jsonb,
  pickup jsonb not null default '{"enabled":true,"etaMin":20,"etaMax":30}'::jsonb,
  table_service jsonb not null default '{"enabled":false,"count":10}'::jsonb,
  payment jsonb not null default '{"pix":true,"card":true,"cash":true}'::jsonb,
  next_order_number integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position integer not null default 0,
  visible boolean not null default true
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text not null default '',
  price integer not null check (price >= 0),
  image_url text,
  available boolean not null default true,
  position integer not null default 0,
  -- [{id, name, min, max, options:[{id, name, price, available}]}]
  option_groups jsonb not null default '[]'::jsonb
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  number integer not null,
  created_at timestamptz not null default now(),
  promised_at timestamptz not null,
  status text not null check (status in ('novo', 'em_preparo', 'pronto', 'a_caminho', 'concluido', 'cancelado')),
  history jsonb not null default '[]'::jsonb,
  mode text not null check (mode in ('delivery', 'pickup', 'table')),
  customer jsonb not null,
  delivery jsonb,
  table_number integer,
  items jsonb not null,
  subtotal integer not null,
  delivery_fee integer not null default 0,
  total integer not null,
  payment jsonb not null,
  notes text,
  unique (store_id, number)
);

create index if not exists categories_store_idx on public.categories (store_id);
create index if not exists products_store_idx on public.products (store_id);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists orders_store_created_idx on public.orders (store_id, created_at desc);

-- ---------------------------------------------------------------------
-- Equipe da loja: cada pessoa entra com o próprio login e tem uma função
--   owner (dono) · manager (gerente) · cashier (caixa) · waiter (garçom) · kitchen (cozinha)
-- As regras de acesso leem esta tabela. stores.owner_id fica como o dono que criou a loja.
-- ---------------------------------------------------------------------

create table if not exists public.store_members (
  store_id uuid not null references public.stores (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'cashier', 'waiter', 'kitchen')),
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);

create index if not exists store_members_user_idx on public.store_members (user_id);

-- Lojas que já existiam antes da equipe: o criador vira dono.
insert into public.store_members (store_id, user_id, role)
select id, owner_id, 'owner' from public.stores
on conflict (store_id, user_id) do nothing;

-- Qualquer função na loja.
create or replace function public.is_store_member(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.store_members where store_id = p_store and user_id = auth.uid());
$$;

-- Uma das funções da lista.
create or replace function public.has_store_role(p_store uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.store_members
    where store_id = p_store and user_id = auth.uid() and role = any (p_roles)
  );
$$;

-- Atalho mantido por compatibilidade: dono = função owner.
create or replace function public.is_store_owner(p_store uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_store_role(p_store, array['owner']);
$$;

-- A loja nunca fica sem dono. Exceção: a própria loja (ou a conta do dono) sendo apagada.
create or replace function public.keep_store_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and (new.role <> 'owner' or new.store_id <> old.store_id)) then
    if not exists (
         select 1 from public.store_members
         where store_id = old.store_id and role = 'owner' and user_id <> old.user_id)
       and exists (select 1 from public.stores where id = old.store_id)
       and exists (select 1 from auth.users where id = old.user_id) then
      raise exception 'A loja precisa de pelo menos um dono.';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists store_members_keep_owner on public.store_members;
create trigger store_members_keep_owner
  before update or delete on public.store_members
  for each row execute function public.keep_store_owner();

-- Gerente pode editar a loja, mas não trocar o dono por um update comum.
create or replace function public.protect_store_owner()
returns trigger
language plpgsql
as $$
begin
  if new.owner_id is distinct from old.owner_id then
    raise exception 'O dono da loja não pode ser trocado por aqui.';
  end if;
  return new;
end;
$$;

drop trigger if exists stores_protect_owner on public.stores;
create trigger stores_protect_owner
  before update on public.stores
  for each row execute function public.protect_store_owner();

-- ---------------------------------------------------------------------
-- Permissões de tabela. Projetos novos do Supabase não liberam sozinhos o acesso às tabelas
-- criadas pelo SQL Editor; sem isto, tudo volta "permission denied". Quem vê e muda o quê,
-- linha a linha, continua sendo decidido pelas regras (RLS) logo abaixo.
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select on public.stores, public.categories, public.products to anon, authenticated;
grant update on public.stores to authenticated;
grant insert, update, delete on public.categories, public.products to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert, update, delete on public.store_members to authenticated;

-- ---------------------------------------------------------------------
-- Segurança por linha (RLS)
-- ---------------------------------------------------------------------

alter table public.stores enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.store_members enable row level security;

-- Lojas: qualquer um lê (é o cardápio público); dono e gerente alteram. A loja nasce pelo trigger do cadastro.
drop policy if exists "lojas: leitura pública" on public.stores;
create policy "lojas: leitura pública" on public.stores for select using (true);
drop policy if exists "lojas: dono altera" on public.stores;
drop policy if exists "lojas: dono e gerente alteram" on public.stores;
create policy "lojas: dono e gerente alteram" on public.stores for update
  using (public.has_store_role(id, array['owner', 'manager']))
  with check (public.has_store_role(id, array['owner', 'manager']));

-- Categorias e itens: leitura pública, escrita de dono e gerente.
drop policy if exists "categorias: leitura pública" on public.categories;
create policy "categorias: leitura pública" on public.categories for select using (true);
drop policy if exists "categorias: dono cria" on public.categories;
drop policy if exists "categorias: dono e gerente criam" on public.categories;
create policy "categorias: dono e gerente criam" on public.categories for insert
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "categorias: dono altera" on public.categories;
drop policy if exists "categorias: dono e gerente alteram" on public.categories;
create policy "categorias: dono e gerente alteram" on public.categories for update
  using (public.has_store_role(store_id, array['owner', 'manager']))
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "categorias: dono apaga" on public.categories;
drop policy if exists "categorias: dono e gerente apagam" on public.categories;
create policy "categorias: dono e gerente apagam" on public.categories for delete
  using (public.has_store_role(store_id, array['owner', 'manager']));

drop policy if exists "itens: leitura pública" on public.products;
create policy "itens: leitura pública" on public.products for select using (true);
drop policy if exists "itens: dono cria" on public.products;
drop policy if exists "itens: dono e gerente criam" on public.products;
create policy "itens: dono e gerente criam" on public.products for insert
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "itens: dono altera" on public.products;
drop policy if exists "itens: dono e gerente alteram" on public.products;
create policy "itens: dono e gerente alteram" on public.products for update
  using (public.has_store_role(store_id, array['owner', 'manager']))
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "itens: dono apaga" on public.products;
drop policy if exists "itens: dono e gerente apagam" on public.products;
create policy "itens: dono e gerente apagam" on public.products for delete
  using (public.has_store_role(store_id, array['owner', 'manager']));

-- Pedidos: toda a equipe lê e muda o andamento. Dono, gerente, caixa e garçom lançam pedidos
-- direto (PDV, app do garçom, "Simular pedido"). O cliente cria por place_order e acompanha
-- por get_public_order.
drop policy if exists "pedidos: dono lê" on public.orders;
drop policy if exists "pedidos: equipe lê" on public.orders;
create policy "pedidos: equipe lê" on public.orders for select using (public.is_store_member(store_id));
drop policy if exists "pedidos: dono altera" on public.orders;
drop policy if exists "pedidos: equipe altera" on public.orders;
create policy "pedidos: equipe altera" on public.orders for update
  using (public.is_store_member(store_id)) with check (public.is_store_member(store_id));
drop policy if exists "pedidos: dono simula" on public.orders;
drop policy if exists "pedidos: equipe lança" on public.orders;
create policy "pedidos: equipe lança" on public.orders for insert
  with check (public.has_store_role(store_id, array['owner', 'manager', 'cashier', 'waiter']));

-- Equipe: cada membro vê a equipe da própria loja; só o dono adiciona, muda função ou remove.
drop policy if exists "equipe: membros veem" on public.store_members;
create policy "equipe: membros veem" on public.store_members for select using (public.is_store_member(store_id));
drop policy if exists "equipe: dono adiciona" on public.store_members;
create policy "equipe: dono adiciona" on public.store_members for insert
  with check (public.has_store_role(store_id, array['owner']));
drop policy if exists "equipe: dono muda função" on public.store_members;
create policy "equipe: dono muda função" on public.store_members for update
  using (public.has_store_role(store_id, array['owner']))
  with check (public.has_store_role(store_id, array['owner']));
drop policy if exists "equipe: dono remove" on public.store_members;
create policy "equipe: dono remove" on public.store_members for delete
  using (public.has_store_role(store_id, array['owner']));

-- ---------------------------------------------------------------------
-- Cadastro: cria a loja e põe quem se cadastrou como dono
-- (raw_user_meta_data: name, store_name, store_slug).
-- Conta criada para a equipe (raw_user_meta_data.kind = 'staff') não ganha loja própria:
-- ela entra na loja quando o dono a adiciona em store_members.
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reserved text[] := array['painel', 'entrar', 'criar-conta', 'api', 'sobre', 'termos', 'privacidade',
                           'creditos-das-fotos', 'bar-do-cais'];
  base text;
  candidate text;
  n integer := 2;
  new_store_id uuid;
begin
  if coalesce(new.raw_user_meta_data ->> 'kind', '') = 'staff' then
    return new;
  end if;

  base := lower(coalesce(new.raw_user_meta_data ->> 'store_slug', ''));
  base := regexp_replace(base, '[^a-z0-9-]', '-', 'g');
  base := regexp_replace(base, '-{2,}', '-', 'g');
  base := trim(both '-' from left(trim(both '-' from base), 36));
  if length(base) < 3 then
    base := 'minha-loja';
  end if;

  candidate := base;
  while exists (select 1 from public.stores where slug = candidate) or candidate = any (reserved) loop
    candidate := base || '-' || n;
    n := n + 1;
  end loop;

  insert into public.stores (owner_id, slug, name)
  values (new.id, candidate, coalesce(nullif(trim(new.raw_user_meta_data ->> 'store_name'), ''), 'Minha loja'))
  returning id into new_store_id;

  insert into public.store_members (store_id, user_id, role)
  values (new_store_id, new.id, 'owner');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Loja aberta agora? (mesma regra de src/lib/domain/hours.ts, no fuso da loja)
-- Status manual vence; turno com fechamento <= abertura passa da meia-noite.
-- ---------------------------------------------------------------------

create or replace function public.store_is_open(s public.stores, at_time timestamptz default now())
returns boolean
language plpgsql
stable
as $$
declare
  local_ts timestamp := at_time at time zone s.timezone;
  today date := (at_time at time zone s.timezone)::date;
  day_offset integer;
  dow integer;
  iv jsonb;
  open_min integer;
  close_min integer;
  start_ts timestamp;
  end_ts timestamp;
begin
  if s.manual_status = 'open' then
    return true;
  end if;
  if s.manual_status = 'closed' then
    return false;
  end if;

  -- Ontem entra por causa dos turnos que viram a meia-noite.
  foreach day_offset in array array[-1, 0] loop
    dow := extract(dow from today + day_offset)::integer;
    for iv in select * from jsonb_array_elements(coalesce(s.hours -> dow::text, '[]'::jsonb)) loop
      open_min := split_part(iv ->> 'open', ':', 1)::integer * 60 + split_part(iv ->> 'open', ':', 2)::integer;
      close_min := split_part(iv ->> 'close', ':', 1)::integer * 60 + split_part(iv ->> 'close', ':', 2)::integer;
      if close_min <= open_min then
        close_min := close_min + 1440;
      end if;
      start_ts := (today + day_offset)::timestamp + make_interval(mins => open_min);
      end_ts := (today + day_offset)::timestamp + make_interval(mins => close_min);
      if local_ts >= start_ts and local_ts < end_ts then
        return true;
      end if;
    end loop;
  end loop;
  return false;
end;
$$;

-- ---------------------------------------------------------------------
-- Criar pedido (cliente, logado ou não). Nunca confia no preço da tela.
-- payload: {storeId, mode, lines:[{productId, selections:{groupId:[optionId]}, quantity, notes}],
--           customer:{name, phone}, delivery:{regionId, street, number, complement, reference},
--           tableNumber, payment:{method, changeFor}, notes}
-- ---------------------------------------------------------------------

create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.stores%rowtype;
  p public.products%rowtype;
  new_order public.orders%rowtype;
  changed constant text := 'Um item da sacola mudou no cardápio. Remova e adicione de novo.';
  order_mode text := payload ->> 'mode';
  cust_name text := trim(coalesce(payload #>> '{customer,name}', ''));
  cust_phone text := regexp_replace(coalesce(payload #>> '{customer,phone}', ''), '\D', '', 'g');
  pay_method text := coalesce(payload #>> '{payment,method}', '');
  change_for integer;
  table_no integer;
  line jsonb;
  grp jsonb;
  opt jsonb;
  region jsonb;
  sel_group text;
  sel_ids jsonb;
  opt_id text;
  item_opts jsonb;
  items jsonb := '[]'::jsonb;
  qty integer;
  unit integer;
  chosen integer;
  subtotal integer := 0;
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

  -- Itens: produto disponível em categoria visível, quantidade 1..50, opções válidas.
  for line in select * from jsonb_array_elements(payload -> 'lines') loop
    select pr.* into p
    from public.products pr
    join public.categories c on c.id = pr.category_id
    where pr.id::text = line ->> 'productId' and pr.store_id = s.id and pr.available and c.visible;
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

    -- Mínimo e máximo de cada grupo do item.
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

  -- Modalidade.
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

  -- Numeração em sequência: a linha da loja está travada (for update) até o fim da transação.
  num := s.next_order_number;
  update public.stores set next_order_number = next_order_number + 1 where id = s.id;

  insert into public.orders (store_id, number, promised_at, status, history, mode, customer, delivery,
                             table_number, items, subtotal, delivery_fee, total, payment, notes)
  values (
    s.id, num, now() + make_interval(mins => eta), 'novo',
    jsonb_build_array(jsonb_build_object('status', 'novo', 'at', now())),
    order_mode,
    jsonb_build_object('name', left(cust_name, 80), 'phone', cust_phone),
    delivery_out,
    case when order_mode = 'table' then table_no end,
    items, subtotal, fee, total,
    case when pay_method = 'cash' and change_for is not null
         then jsonb_build_object('method', 'cash', 'changeFor', change_for)
         else jsonb_build_object('method', pay_method) end,
    nullif(left(trim(coalesce(payload ->> 'notes', '')), 200), '')
  )
  returning * into new_order;

  return to_jsonb(new_order);
end;
$$;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Acompanhamento do pedido pelo cliente: só pelo id (uuid, impossível de adivinhar)
-- ---------------------------------------------------------------------

create or replace function public.get_public_order(order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(o) from public.orders o where o.id = order_id;
$$;

revoke all on function public.get_public_order(uuid) from public;
grant execute on function public.get_public_order(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Próximo número de pedido, para a equipe lançar pedidos direto (PDV, garçom, simular)
-- ---------------------------------------------------------------------

create or replace function public.take_order_number(p_store uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  num integer;
begin
  if not public.has_store_role(p_store, array['owner', 'manager', 'cashier', 'waiter']) then
    raise exception 'Só a equipe da loja pode fazer isso.';
  end if;
  update public.stores set next_order_number = next_order_number + 1
  where id = p_store
  returning next_order_number - 1 into num;
  return num;
end;
$$;

revoke all on function public.take_order_number(uuid) from public;
grant execute on function public.take_order_number(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Fotos (logo e itens): bucket público; dono e gerente mexem só na pasta {store_id}/ da loja
-- ---------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

create or replace function public.owns_photo_path(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  folder text := split_part(object_name, '/', 1);
begin
  if folder !~ '^[0-9a-f-]{36}$' then
    return false;
  end if;
  return public.has_store_role(folder::uuid, array['owner', 'manager']);
end;
$$;

drop policy if exists "fotos: leitura pública" on storage.objects;
create policy "fotos: leitura pública" on storage.objects for select using (bucket_id = 'fotos');
drop policy if exists "fotos: dono envia" on storage.objects;
create policy "fotos: dono envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.owns_photo_path(name));
drop policy if exists "fotos: dono troca" on storage.objects;
create policy "fotos: dono troca" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.owns_photo_path(name));
drop policy if exists "fotos: dono apaga" on storage.objects;
create policy "fotos: dono apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.owns_photo_path(name));

-- ---------------------------------------------------------------------
-- Tempo real: o painel recebe pedidos novos e mudanças de status na hora
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end;
$$;
