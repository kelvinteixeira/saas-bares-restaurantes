-- =====================================================================
-- Comanda · 009 · Cadastro de entregadores e acerto por entrega
-- Rode DEPOIS do 008, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Regras:
--   · dono e gerente cadastram os entregadores; quanto cada um ganha por entrega:
--     a taxa de entrega do pedido ('fee') ou um valor fixo ('fixed');
--   · dono, gerente e caixa escolhem o entregador de um pedido de entrega; o valor a pagar
--     fica guardado no pedido naquela hora (mudar o cadastro depois não muda o acerto antigo);
--   · entregador desativado não recebe pedidos novos.

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  phone text not null default '' check (phone = '' or phone ~ '^[0-9]{10,11}$'),
  pay_kind text not null default 'fee' check (pay_kind in ('fee', 'fixed')),
  pay_amount integer not null default 0 check (pay_amount >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists drivers_store_idx on public.drivers (store_id);

alter table public.orders add column if not exists driver_id uuid references public.drivers (id) on delete set null;
alter table public.orders add column if not exists driver_pay integer not null default 0 check (driver_pay >= 0);
create index if not exists orders_driver_idx on public.orders (driver_id) where driver_id is not null;

alter table public.drivers enable row level security;
grant select, insert, update, delete on public.drivers to authenticated;

drop policy if exists "entregadores: equipe vê" on public.drivers;
create policy "entregadores: equipe vê" on public.drivers for select
  using (public.is_store_member(store_id));
drop policy if exists "entregadores: dono e gerente criam" on public.drivers;
create policy "entregadores: dono e gerente criam" on public.drivers for insert
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "entregadores: dono e gerente alteram" on public.drivers;
create policy "entregadores: dono e gerente alteram" on public.drivers for update
  using (public.has_store_role(store_id, array['owner', 'manager']))
  with check (public.has_store_role(store_id, array['owner', 'manager']));
drop policy if exists "entregadores: dono e gerente apagam" on public.drivers;
create policy "entregadores: dono e gerente apagam" on public.drivers for delete
  using (public.has_store_role(store_id, array['owner', 'manager']));

-- Escolhe (ou tira, com p_driver nulo) o entregador do pedido e guarda quanto ele recebe.
create or replace function public.assign_driver(p_order uuid, p_driver uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
  d public.drivers%rowtype;
  pay integer := 0;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or not public.has_store_role(o.store_id, array['owner', 'manager', 'cashier']) then
    raise exception 'Só o caixa, o gerente ou o dono escolhem o entregador.';
  end if;
  if o.mode <> 'delivery' then
    raise exception 'Só pedido de entrega tem entregador.';
  end if;
  if o.status = 'cancelado' then
    raise exception 'Este pedido foi cancelado.';
  end if;

  if p_driver is not null then
    select * into d from public.drivers where id = p_driver and store_id = o.store_id;
    if not found then
      raise exception 'Entregador não encontrado.';
    end if;
    if not d.active and o.driver_id is distinct from d.id then
      raise exception '% está desativado.', d.name;
    end if;
    pay := case when d.pay_kind = 'fee' then o.delivery_fee else d.pay_amount end;
  end if;

  update public.orders set driver_id = p_driver, driver_pay = pay where id = p_order returning * into o;
  return to_jsonb(o);
end;
$$;

revoke all on function public.assign_driver(uuid, uuid) from public;
grant execute on function public.assign_driver(uuid, uuid) to authenticated;
