-- Carrusel de eventos de la home pública (/), TKT-12.
--
-- Curado a mano: NO sale del inventario. El admin arma las tarjetas desde
-- /admin/entradas → "Carrusel de la home": nombre del evento, competencia o
-- categoría, mes y año, y una foto encuadrada a 4:3 (1200×900) en el panel.
-- Una tarjeta sin foto no se muestra; tampoco la de un mes que ya pasó. La
-- home muestra hasta 8, en `orden`; el tope de filas lo controla
-- /api/carrusel.
--
-- Nada de precio, stock ni disponibilidad: la tabla no tiene dónde guardarlo.
-- Lectura pública (la home la lee con la anon key); escritura solo service
-- role desde la API.
--
-- Reemplaza a la versión anterior de esta migración (fotos_carrusel, fotos
-- por competición/evento del catálogo), que nunca llegó a main.

drop table if exists public.fotos_carrusel;

create table if not exists public.carrusel_home (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(nombre) between 1 and 120),
  categoria text not null check (length(categoria) between 1 and 80),
  -- Primer día del mes del evento: la tarjeta muestra mes y año.
  mes date not null check (extract(day from mes) = 1),
  imagen_url text,
  orden int not null default 0,
  actualizada_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists carrusel_home_orden_idx on public.carrusel_home (orden);

alter table public.carrusel_home enable row level security;

-- La home solo necesita estas columnas; `actualizada_por` (email del admin) no sale.
revoke all on public.carrusel_home from public, anon, authenticated;
grant select (id, nombre, categoria, mes, imagen_url, orden) on public.carrusel_home to anon;

drop policy if exists carrusel_home_select_anon on public.carrusel_home;
create policy carrusel_home_select_anon
  on public.carrusel_home
  for select
  to anon
  using (true);

-- Bucket público para servir las fotos (lectura anónima por URL pública;
-- escritura solo service role, que ignora RLS de storage). Mismo criterio que
-- `mapas` (0016), pero separado: estas fotos se borran desde el panel.
insert into storage.buckets (id, name, public)
values ('carrusel', 'carrusel', true)
on conflict (id) do nothing;
