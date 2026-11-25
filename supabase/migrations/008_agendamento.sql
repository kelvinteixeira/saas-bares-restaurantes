-- =====================================================================
-- Comanda · 008 · Pedido agendado
-- Rode DEPOIS do 007, no SQL Editor do Supabase. Pode rodar de novo sem estragar nada.
-- =====================================================================
-- Regras:
--   · a loja liga o agendamento, a antecedência mínima (15 min a 24 h) e até quantos dias à frente (1 a 14);
--   · horários de 30 em 30 minutos, dentro do horário de funcionamento daquele dia
--     (o "abrir/fechar agora" manual não vale para o futuro);
--   · com o agendamento ligado, dá para pedir mesmo com a loja fechada agora, para mais tarde;
--   · pedido na mesa não agenda; o prazo prometido do pedido vira o horário agendado.

alter table public.stores add column if not exists scheduling jsonb not null default '{"enabled": false, "leadMinutes": 60, "maxDays": 7}'::jsonb;
alter table public.orders add column if not exists scheduled_for timestamptz;
create index if not exists orders_scheduled_idx on public.orders (store_id, scheduled_for) where scheduled_for is not null;

-- A loja está aberta nesse horário pelos horários cadastrados (ignora o abrir/fechar manual).
create or replace function public.store_hours_open(s public.stores, at_time timestamptz)
returns boolean
language plpgsql
stable
as $$
declare
  v public.stores%rowtype := s;
begin
  v.manual_status := 'auto';
  return public.store_is_open(v, at_time);
end;
$$;

-- Confere o horário escolhido. Devolve nada; levanta a mensagem para o cliente.
create or replace function public.check_schedule(s public.stores, p_at timestamptz, p_mode text)
returns void
language plpgsql
stable
as $$
declare
  lead_min integer := least(greatest(coalesce((s.scheduling ->> 'leadMinutes')::integer, 60), 15), 1440);
  max_days integer := least(greatest(coalesce((s.scheduling ->> 'maxDays')::integer, 7), 1), 14);
begin
  if not coalesce((s.scheduling ->> 'enabled')::boolean, false) then
    raise exception 'Esta loja não aceita pedidos agendados.';
  end if;
  if p_mode = 'table' then
    raise exception 'Pedido na mesa não pode ser agendado.';
  end if;
  if extract(second from p_at) <> 0 or extract(minute from p_at)::integer % 30 <> 0 then
    raise exception 'Escolha um dos horários da lista.';
  end if;
  if p_at < now() + make_interval(mins => lead_min) then
    raise exception 'Esse horário já não dá mais. Escolha outro.';
  end if;
  if p_at > now() + make_interval(days => max_days) then
    raise exception 'Dá para agendar até % dias à frente.', max_days;
  end if;
  if not public.store_hours_open(s, p_at) then
    raise exception 'A loja está fechada nesse horário.';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- place_order: igual ao 007, agora com payload.scheduledFor (ISO).
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
  scheduled timestamptz;
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
    scheduled := nullif(payload ->> 'scheduledFor', '')::timestamptz;
  exception when others then
    raise exception 'Dados do pedido inválidos.';
  end;

  select * into s from public.stores where id::text = payload ->> 'storeId' for update;
  if not found then
    raise exception 'Loja não encontrada.';
  end if;
  if order_mode is null or order_mode not in ('delivery', 'pickup', 'table') then
    raise exception 'Escolha como quer receber o pedido.';
  end if;
  -- Agendado: vale o horário escolhido; agora: a loja precisa estar aberta.
  if scheduled is not null then
    perform public.check_schedule(s, scheduled, order_mode);
  elsif not public.store_is_open(s) then
    raise exception 'A loja fechou enquanto você montava o pedido.';
  end if;
  if jsonb_typeof(payload -> 'lines') is distinct from 'array' or jsonb_array_length(payload -> 'lines') = 0 then
    raise exception 'A sacola está vazia.';
  end if;
  if cust_name = '' then
    raise exception 'Informe seu nome.';
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
                             discount, coupon_id, coupon_code, cashback_used, scheduled_for)
  values (
    s.id, num, coalesce(scheduled, now() + make_interval(mins => eta)), 'novo',
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
    discount, (coupon ->> 'couponId')::uuid, coupon ->> 'code', cashback, scheduled
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
