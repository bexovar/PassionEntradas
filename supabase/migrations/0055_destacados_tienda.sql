-- Eventos destacados de la tienda (/entradas), TKT-14.
--
-- Número 0055: 0052 lo usa TKT-11 (0052_solicitud_organizacion) en su rama.
--
-- Curado a mano: el admin elige desde /admin/configuracion → "Destacados de
-- la tienda" qué eventos del catálogo van en el bloque del medio (hoy serían
-- Boca, River, Boca-Estudiantes). Se guarda la competición y el nombre del
-- evento tal como los agrupa la tienda (lib/tickets.ts → buildEvents): si el
-- evento sale del catálogo, el destacado no se muestra, pero la fila queda
-- para cuando vuelva.
--
-- Lectura pública (la tienda la lee con la anon key); escritura solo service
-- role desde /api/destacados. Aditiva: sin filas, la tienda muestra los que
-- tienen stock (ver lib/resumen-home.ts).

create table if not exists public.destacados_tienda (
  id uuid primary key default gen_random_uuid(),
  competicion text not null check (length(competicion) between 1 and 200),
  evento text not null check (length(evento) between 1 and 300),
  orden int not null default 0,
  actualizada_por text,
  created_at timestamptz not null default now(),
  unique (competicion, evento)
);

create index if not exists destacados_tienda_orden_idx on public.destacados_tienda (orden);

alter table public.destacados_tienda enable row level security;

-- La tienda solo necesita estas columnas; `actualizada_por` (email del admin) no sale.
revoke all on public.destacados_tienda from public, anon, authenticated;
grant select (id, competicion, evento, orden) on public.destacados_tienda to anon;

drop policy if exists destacados_tienda_select_anon on public.destacados_tienda;
create policy destacados_tienda_select_anon
  on public.destacados_tienda
  for select
  to anon
  using (true);
