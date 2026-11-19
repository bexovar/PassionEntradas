-- Máquina de estados de la operación (TKT-21, base de TKT-18).
--
-- Las etapas que ve el panel salen de los hitos, en un orden fijo:
--
--   pendiente de confirmar → esperando pago (→ vencido a las 24 h)
--   → pago informado → pendiente de pago al proveedor
--   → esperando envío del proveedor → listo para enviar → entregada
--
-- más dos salidas: cancelada (status) y reembolso (pendiente → hecho).
-- La etapa NO se guarda: se calcula en lib/etapas.ts, así una fila vieja con
-- los hitos marcados en otro orden cae sola en el primer paso que le falta.
-- El orden lo impone la API (/api/operaciones/[id]/status): solo se marca el
-- paso siguiente y solo se desmarca el último.
--
-- Columnas nuevas (todas nullable, aditiva):
--   pago_pedido_at      — cuándo se le pidió el pago al cliente: desde ahí
--                         corren las 24 h del "vencido". Lo pone confirmar el
--                         pedido, o "volver a pedir el pago" en un vencido.
--   pago_informado_*    — el cliente avisó que pagó (falta verlo en el banco).
--   reembolso_*         — no se consiguió la entrada: hay que devolver la plata.
--   reembolsado_*       — la plata ya se devolvió.
--
-- Backfill: con el flujo anterior el pago se le pedía al cliente cuando
-- llegaba la entrada del proveedor ("para pagar"). Las que están así y sin
-- pagar quedan con ese momento como pedido de pago.
--
-- ORDEN: aplicar ANTES de deployar el código de TKT-21: el panel lee estas
-- columnas y sin ellas la consulta falla. Aplicarla antes es seguro: el
-- código viejo no las usa.
--
-- Número 0056: 0052 es de TKT-11 y 0055 de TKT-14, cada una en su rama.

alter table public.operaciones
  add column if not exists pago_pedido_at timestamptz,
  add column if not exists pago_informado_at timestamptz,
  add column if not exists pago_informado_por text,
  add column if not exists reembolso_at timestamptz,
  add column if not exists reembolso_por text,
  add column if not exists reembolsado_at timestamptz,
  add column if not exists reembolsado_por text;

-- monto > 0: el check NOT VALID operaciones_monto_positivo rechaza cualquier
-- UPDATE de una fila con monto 0 (mismo criterio que 0040).
update public.operaciones
   set pago_pedido_at = entrada_recibida_at
 where pago_pedido_at is null
   and entrada_recibida_at is not null
   and pago_confirmado_at is null
   and status <> 'cancelada'
   and monto > 0;

-- Misma función que 0054 más las reglas del reembolso y de los hitos nuevos.
create or replace function public.validar_orden_hitos()
returns trigger language plpgsql as $$
declare
  completa_antes boolean;
  completa_ahora boolean;
begin
  if new.status = 'cancelada' and new.cerrada_at is not null then
    raise exception 'Una operación cancelada no puede estar cerrada' using errcode = 'P0001';
  end if;

  -- Reembolso: solo de algo no entregado, y "reembolsado" después de pedido.
  if new.reembolso_at is not null and new.cerrada_at is not null then
    raise exception 'Una operación entregada no se reembolsa' using errcode = 'P0001';
  end if;
  if new.reembolsado_at is not null and new.reembolso_at is null then
    raise exception 'Primero marcá el reembolso como pendiente' using errcode = 'P0001';
  end if;

  -- El cliente cancela hasta que le avisamos que procesamos el pago (TKT-19).
  if new.status = 'cancelada' and new.cancelada_por = 'cliente'
     and (tg_op = 'INSERT' or old.status <> 'cancelada')
     and (new.pago_confirmado_at is not null
          or new.cerrada_at is not null) then
    raise exception 'El pedido ya avanzó; para cancelarlo escribinos' using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'cancelada' and new.status = 'cancelada'
       and (new.entrada_recibida_at is distinct from old.entrada_recibida_at
            or new.pago_confirmado_at is distinct from old.pago_confirmado_at
            or new.pago_proveedor_at is distinct from old.pago_proveedor_at
            or new.pago_informado_at is distinct from old.pago_informado_at) then
      raise exception 'La operación está cancelada; reabrila para editar hitos' using errcode = 'P0001';
    end if;

    -- En reembolso los hitos quedan quietos: se resuelve devolviendo la plata.
    if old.reembolso_at is not null and new.reembolso_at is not null
       and (new.entrada_recibida_at is distinct from old.entrada_recibida_at
            or new.pago_confirmado_at is distinct from old.pago_confirmado_at
            or new.pago_proveedor_at is distinct from old.pago_proveedor_at
            or new.pago_informado_at is distinct from old.pago_informado_at
            or new.cerrada_at is distinct from old.cerrada_at) then
      raise exception 'La operación está en reembolso; sacala del reembolso para editar hitos' using errcode = 'P0001';
    end if;

    completa_antes := old.entrada_recibida_at is not null
                  and old.pago_confirmado_at is not null
                  and old.pago_proveedor_at is not null
                  and old.cerrada_at is not null;
    completa_ahora := new.entrada_recibida_at is not null
                  and new.pago_confirmado_at is not null
                  and new.pago_proveedor_at is not null
                  and new.cerrada_at is not null;

    if completa_antes and completa_ahora
       and (new.entrada_recibida_at is distinct from old.entrada_recibida_at
            or new.pago_confirmado_at is distinct from old.pago_confirmado_at
            or new.pago_proveedor_at is distinct from old.pago_proveedor_at) then
      raise exception 'La operación está completa; desmarcá un hito para volver a editarla' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.validar_orden_hitos() from public, anon, authenticated;
grant  execute on function public.validar_orden_hitos() to service_role;
