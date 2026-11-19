-- TKT-21: un reembolso no es una venta.
--
-- Con la salida por reembolso (0056), una operación cobrada que después se
-- reembolsa conserva su pago_confirmado_at y no se cancela. Por eso
-- metricas_operaciones la seguía sumando en plata movida, comisión y entradas
-- vendidas: lo que el panel muestra como "Ventas acumuladas" y "Comisión
-- acumulada" (TKT-22) y la página de Métricas.
--
-- Ahora una operación con reembolso, pendiente o hecho, no cuenta en nada,
-- igual que una cancelada. Es la misma definición que 0040 con ese filtro. El
-- espejo para el modo demo está en lib/metrics.ts (computeMetrics) y tienen
-- que coincidir.
--
-- ORDEN: después de 0056, que crea reembolso_at. Número 0059 porque 0057 y
-- 0058 son de TKT-18 y TKT-10.
--
-- Misma firma que 0040, así que create or replace no crea una función nueva;
-- igual los permisos se repiten acá (README, reglas 3 y 4).

create or replace function public.metricas_operaciones(p_desde date default null, p_hasta date default null)
returns table (
  moneda text, plata_movida numeric, comision_ganada numeric,
  entradas_vendidas bigint, en_juego_monto numeric, en_juego_ops bigint
)
language sql stable security definer set search_path = public
as $$
  with ops as (
    select
      o.moneda, o.monto, o.fee, coalesce(o.cantidad, 1) as cantidad,
      o.pago_confirmado_at, o.cerrada_at,
      (o.tipo = 'pedido' and o.confirmada_at is null) as por_confirmar,
      (o.pago_confirmado_at at time zone 'America/Argentina/Buenos_Aires')::date as dia_pago
    from public.operaciones o
    where o.status <> 'cancelada'
      and o.reembolso_at is null
  ), vendidas as (
    select * from ops
    where pago_confirmado_at is not null
      and (p_desde is null or dia_pago >= p_desde)
      and (p_hasta is null or dia_pago <= p_hasta)
  ), en_juego as (
    select * from ops
    where pago_confirmado_at is null and cerrada_at is null and not por_confirmar
  )
  select
    m.moneda,
    coalesce((select sum(v.monto) from vendidas v where v.moneda = m.moneda), 0),
    coalesce((select sum(v.fee) from vendidas v where v.moneda = m.moneda), 0),
    coalesce((select sum(v.cantidad) from vendidas v where v.moneda = m.moneda), 0)::bigint,
    coalesce((select sum(j.monto) from en_juego j where j.moneda = m.moneda), 0),
    (select count(*) from en_juego j where j.moneda = m.moneda)::bigint
  from (select distinct moneda from ops) m
$$;

revoke all on function public.metricas_operaciones(date, date) from public, anon, authenticated;
grant execute on function public.metricas_operaciones(date, date) to service_role;
