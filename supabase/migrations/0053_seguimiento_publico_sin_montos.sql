-- TKT-24: el link público de seguimiento (/op/<uuid>) no expone lo que la
-- agencia le paga a TicketMirror.
--
-- La agencia le manda el link a su pasajero. `monto` y `precio_unitario` son
-- el costo de la agencia: si el pasajero los ve, ve el margen de la agencia.
-- La página ya los saca de la vista pública (lib/seguimiento-publico.ts),
-- pero estos RPC se pueden llamar directo con la anon key y el uuid, así que
-- el dato tiene que dejar de salir de la base. `comprador_alias` sale solo
-- con el nombre de pila (y nada si es un email).
--
-- El agente dueño y el staff ven los importes igual: la página los lee con
-- service role de las tablas, no de estos RPC. Por eso esta migración se
-- puede aplicar antes o después de deployar el código de TKT-24.
--
-- Sacar columnas del RETURNS TABLE no se puede con create or replace: hay que
-- recrear las funciones. Los grants van acá mismo (README, regla 3).
-- 0052 queda para TKT-11 (formulario de alta), que va en su propia rama.

drop function if exists public.operacion_publica(uuid);

create function public.operacion_publica(op_id uuid)
returns table (
  code text, evento text, comprador_alias text, vendedor_alias text,
  moneda text, status operacion_status,
  entrada_recibida_at timestamptz, pago_confirmado_at timestamptz,
  cerrada_at timestamptz, fecha_evento date, updated_at timestamptz,
  tipo text, confirmada_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select o.code, o.evento,
         case
           when o.comprador_alias is null or position('@' in o.comprador_alias) > 0 then null
           else nullif((regexp_split_to_array(btrim(o.comprador_alias), '\s+'))[1], '')
         end,
         o.vendedor_alias, o.moneda,
         o.status, o.entrada_recibida_at, o.pago_confirmado_at,
         o.cerrada_at, o.fecha_evento, o.updated_at, o.tipo, o.confirmada_at
  from public.operaciones o
  where o.id = op_id
$$;

revoke all on function public.operacion_publica(uuid) from public;
grant execute on function public.operacion_publica(uuid) to anon, authenticated, service_role;

drop function if exists public.operacion_items_publicos(uuid);

create function public.operacion_items_publicos(op_id uuid)
returns table (
  evento text,
  sector text,
  fecha_evento date,
  cantidad integer
)
language sql
stable
security definer
set search_path = public
as $$
  select i.evento, i.sector, i.fecha_evento, i.cantidad
  from public.operacion_items i
  where i.operacion_id = op_id
  order by i.created_at asc
$$;

revoke all on function public.operacion_items_publicos(uuid) from public;
grant execute on function public.operacion_items_publicos(uuid) to anon, authenticated;
