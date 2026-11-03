-- TKT-11: el formulario de solicitud pide la organización (tipo y nombre)
-- antes que la persona. Con estos datos, quien aprueba sabe qué boca de venta
-- es, y TKT-10 va a armar la organización en el momento de la aprobación.
--
-- Aditiva y nullable a propósito: las solicitudes ya cargadas no tienen
-- organización, y la obligatoriedad para las nuevas vive en la validación de
-- la API (lib/acceso.ts), igual que con `legajo`.
--
-- El CUIT NO lleva columna nueva: sigue en `legajo`, que es la que viaja a la
-- cuenta del cliente y a la factura. Desde TKT-11 llega validado (formato y
-- dígito verificador) y siempre con guiones: "20-12345678-6".

alter table public.solicitudes_acceso
  add column if not exists tipo_organizacion text,
  add column if not exists organizacion text;

-- Lista cerrada (el dropdown del formulario). NULL = solicitud anterior.
alter table public.solicitudes_acceso
  drop constraint if exists solicitudes_acceso_tipo_organizacion_check;
alter table public.solicitudes_acceso
  add constraint solicitudes_acceso_tipo_organizacion_check
  check (tipo_organizacion is null or tipo_organizacion in ('agencia', 'operador', 'freelance', 'hoteleria', 'otro'));

comment on column public.solicitudes_acceso.tipo_organizacion is
  'Tipo de organización que pide acceso: agencia, operador, freelance, hoteleria u otro. NULL en las solicitudes anteriores a TKT-11.';
comment on column public.solicitudes_acceso.organizacion is
  'Nombre de la organización (el freelance pone el suyo). NULL en las solicitudes anteriores a TKT-11.';
comment on column public.solicitudes_acceso.legajo is
  'CUIT del solicitante, validado y con guiones (20-12345678-6) desde TKT-11. En las solicitudes anteriores, legajo/CUIL/CUIT en texto libre.';
