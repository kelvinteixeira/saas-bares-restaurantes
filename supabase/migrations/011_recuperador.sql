-- =====================================================================
-- Comanda · 011 · Recuperador de vendas (sacolas abandonadas)
-- Rode DEPOIS do 010, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Regras:
--   · no fechamento do pedido, quando o cliente já digitou um WhatsApp válido, o cardápio guarda
--     a sacola (função save_cart, sem login). Uma sacola aberta por WhatsApp em cada loja;
--   · nomes e preços dos itens vêm do cardápio da loja no banco, não do que o navegador mandar;
--   · quando chega um pedido com o mesmo WhatsApp (até 7 dias depois), a sacola vira "convertida";
--     se a loja tinha chamado o cliente antes, conta como venda recuperada;
--   · dono e gerente veem a lista, marcam que chamaram no WhatsApp ou descartam;
--   · sacolas com mais de 30 dias são apagadas sozinhas.

create table if not exists public.abandoned_carts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  phone text not null check (phone ~ '^[0-9]{10,11}$'),
  name text not null default '' check (length(name) <= 60),
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 50),
  subtotal integer not null default 0 check (subtotal between 0 and 10000000),
  mode text check (mode in ('delivery', 'pickup')),
  status text not null default 'open' check (status in ('open', 'contacted', 'converted', 'dismissed')),
  contacted_at timestamptz,
  order_id uuid references public.orders (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists abandoned_carts_store_idx on public.abandoned_carts (store_id, updated_at desc);
create unique index if not exists abandoned_carts_open_idx on public.abandoned_carts (store_id, phone) where status in ('open', 'contacted');

alter table public.abandoned_carts enable row level security;
grant select, update, delete on public.abandoned_carts to authenticated;

drop policy if exists "sacolas: dono e gerente veem" on public.abandoned_carts;
create policy "sacolas: dono e gerente veem" on public.abandoned_carts for select
  using (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "sacolas: dono e gerente alteram" on public.abandoned_carts;
create policy "sacolas: dono e gerente alteram" on public.abandoned_carts for update
  using (public.has_store_role(store_id, array['owner', 'manager']))
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "sacolas: dono e gerente apagam" on public.abandoned_carts;
create policy "sacolas: dono e gerente apagam" on public.abandoned_carts for delete
  using (public.has_store_role(store_id, array['owner', 'manager']));

-- O cardápio guarda a sacola de quem está fechando o pedido. Não devolve nada (não revela sacolas).
-- p_items: [{"productId": "...", "quantity": 2, "price": 4200}] (price = unitário com adicionais;
-- vale no mínimo o preço do produto no cardápio).
create or replace function public.save_cart(p_store uuid, p_phone text, p_name text, p_items jsonb, p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  ph text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_items jsonb;
  v_total integer;
begin
  if not exists (select 1 from public.stores where id = p_store) then
    return;
  end if;
  if ph !~ '^[0-9]{10,11}$' or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    return;
  end if;
  -- Chegou atrasada (a pessoa acabou de pedir): não abre sacola nova.
  if exists (
    select 1 from public.orders o
     where o.store_id = p_store and o.created_at > now() - interval '2 minutes'
       and regexp_replace(coalesce(o.customer ->> 'phone', ''), '\D', '', 'g') = ph
  ) then
    return;
  end if;

  select
    jsonb_agg(jsonb_build_object('productId', p.id, 'name', p.name, 'quantity', q.qty, 'price', q.price) order by q.ord),
    coalesce(sum(q.qty * q.price), 0)
  into v_items, v_total
  from (
    select
      e.ord,
      (e.item ->> 'productId') as product_id,
      least(greatest(coalesce((e.item ->> 'quantity')::integer, 1), 1), 99) as qty,
      greatest(coalesce((e.item ->> 'price')::integer, 0), 0) as client_price
    from jsonb_array_elements(p_items) with ordinality as e(item, ord)
    where jsonb_typeof(e.item) = 'object'
  ) raw
  join public.products p on p.id::text = raw.product_id and p.store_id = p_store
  cross join lateral (select raw.ord, raw.qty, least(greatest(raw.client_price, p.price), p.price + 100000) as price) q;

  if v_items is null then
    return;
  end if;
  v_total := least(v_total, 10000000);

  -- Limpeza: sacolas antigas desta loja.
  delete from public.abandoned_carts where store_id = p_store and updated_at < now() - interval '30 days';

  update public.abandoned_carts
     set name = left(trim(coalesce(p_name, '')), 60),
         items = v_items,
         subtotal = v_total,
         mode = case when p_mode in ('delivery', 'pickup') then p_mode end,
         updated_at = now()
   where store_id = p_store and phone = ph and status in ('open', 'contacted');
  if not found then
    insert into public.abandoned_carts (store_id, phone, name, items, subtotal, mode)
    values (p_store, ph, left(trim(coalesce(p_name, '')), 60), v_items, v_total, case when p_mode in ('delivery', 'pickup') then p_mode end);
  end if;
exception
  -- Sacola é só um lembrete: nunca dá erro para o cliente.
  when others then
    return;
end;
$$;

revoke all on function public.save_cart(uuid, text, text, jsonb, text) from public;
grant execute on function public.save_cart(uuid, text, text, jsonb, text) to anon, authenticated;

-- Pedido novo com o mesmo WhatsApp: a sacola aberta (ou chamada) vira convertida.
create or replace function public.orders_convert_cart()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ph text := regexp_replace(coalesce(new.customer ->> 'phone', ''), '\D', '', 'g');
begin
  if ph <> '' and new.mode <> 'table' then
    update public.abandoned_carts
       set status = 'converted', order_id = new.id, updated_at = now()
     where store_id = new.store_id and phone = ph and status in ('open', 'contacted')
       and updated_at > now() - interval '7 days';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_convert_cart on public.orders;
create trigger orders_convert_cart after insert on public.orders
  for each row execute function public.orders_convert_cart();

-- Tempo real para a tela do recuperador.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'abandoned_carts'
  ) then
    alter publication supabase_realtime add table public.abandoned_carts;
  end if;
end;
$$;
