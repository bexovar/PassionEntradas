-- TKT-19: el cliente puede cancelar su pedido hasta que le avisamos que
-- procesamos el pago y que la entrada está en camino (pago_confirmado_at),
-- no hasta que se le pide pagar (entrada_recibida_at). Pasado ese punto, Mis
-- pedidos le ofrece pedir la cancelación y la resuelve el equipo.
--
-- Es la misma función que 0040 con una sola condición cambiada: sale
-- `entrada_recibida_at` de la regla de cancelación del cliente. El resto
-- (cancelada no se cierra, cancelada no edita hitos, completa no se edita)
-- queda igual.
--
-- ORDEN: aplicar ANTES de deployar el código de TKT-19. Con el código nuevo y
-- la base vieja, Mis pedidos ofrece "Cancelar pedido" en "para pagar" pero el
-- trigger de 0040 lo rechaza: el copy y el botón no coincidirían. Aplicarla
-- antes es seguro: la ruta vieja igual rechaza cancelar en "para pagar".
--
-- Los permisos van acá mismo (README, regla 3), igual que 0046.
-- 0052 y 0053 quedan para TKT-11 y TKT-24, que van en sus propias ramas.

create or replace function public.validar_orden_hitos()
returns trigger language plpgsql as $$
declare
  completa_antes boolean;
  completa_ahora boolean;
begin
  if new.status = 'cancelada' and new.cerrada_at is not null then
    raise exception 'Una operación cancelada no puede estar cerrada' using errcode = 'P0001';
  end if;

  -- El cliente cancela hasta que le avisamos que procesamos el pago (TKT-19).
  -- Con la entrada ya recibida ("para pagar") todavía puede: es justo cuando
  -- se le pide la plata y aún no la mandó.
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
            or new.pago_proveedor_at is distinct from old.pago_proveedor_at) then
      raise exception 'La operación está cancelada; reabrila para editar hitos' using errcode = 'P0001';
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
