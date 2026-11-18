-- TKT-18: el link público de seguimiento (/op/<uuid>) muestra los estados
-- nuevos: "Pago recibido" cuando el cliente avisa que pagó y el reembolso
-- cuando no se consiguió la entrada.
--
-- Suma cuatro fechas a operacion_publica (las de 0056). Son fechas, no
-- montos: lo que cuidó 0053 (no exponer lo que paga la agencia) sigue igual.
--
-- ORDEN: después de 0056 (crea las columnas). El código de TKT-18 funciona
-- con o sin esta migración: sin ella el link público se ve como antes y Mis
-- pedidos (que lee las tablas con service role) ya muestra los estados nuevos.
--
-- Agregar columnas al RETURNS TABLE no se puede con create or replace: hay que
-- recrear la función. Los grants van acá mismo (README, regla 3).

drop function if exists public.operacion_publica(uuid);

create function public.operacion_publica(op_id uuid)
returns table (
  code text, evento text, comprador_alias text, vendedor_alias text,
  moneda text, status operacion_status,
  entrada_recibida_at timestamptz, pago_confirmado_at timestamptz,
  cerrada_at timestamptz, fecha_evento date, updated_at timestamptz,
  tipo text, confirmada_at timestamptz,
  pago_pedido_at timestamptz, pago_informado_at timestamptz,
  reembolso_at timestamptz, reembolsado_at timestamptz
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
         o.cerrada_at, o.fecha_evento, o.updated_at, o.tipo, o.confirmada_at,
         o.pago_pedido_at, o.pago_informado_at, o.reembolso_at, o.reembolsado_at
  from public.operaciones o
  where o.id = op_id
$$;

revoke all on function public.operacion_publica(uuid) from public;
grant execute on function public.operacion_publica(uuid) to anon, authenticated, service_role;
