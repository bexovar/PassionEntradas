-- =============================================================================
-- 0049 — factura_publica deja de devolver la comisión interna.
--
-- factura_publica (0019) devuelve el snapshot `datos` completo a anon. Desde
-- el modelo costo + comisión, `datos.fee` es un registro INTERNO de la
-- comisión (la factura no lo muestra ni lo suma al total), pero cualquiera
-- con la anon key y el uuid de la factura lo leía llamando al RPC directo.
--
-- Ahora se saca `fee` del jsonb que sale, salvo en las facturas VIEJAS que lo
-- cobraban aparte (total > subtotal): ahí es parte de lo que se le cobró al
-- cliente y la página lo sigue desglosando. Lo guardado en la tabla no cambia.
--
-- Idempotente (create or replace). Los permisos se mantienen: create or
-- replace conserva los grants, y se reafirman abajo igual.
-- =============================================================================

create or replace function public.factura_publica(f_id uuid)
returns table (numero integer, datos jsonb, created_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select
    f.numero,
    case
      when coalesce((f.datos->>'total')::numeric, 0) > coalesce((f.datos->>'subtotal')::numeric, 0)
        then f.datos
      else f.datos - 'fee'
    end,
    f.created_at
  from public.facturas f
  where f.id = f_id;
$$;

revoke all on function public.factura_publica(uuid) from public;
grant execute on function public.factura_publica(uuid) to anon, authenticated;
