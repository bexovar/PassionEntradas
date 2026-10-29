-- Fotos del carrusel de eventos de la home (/).
--
-- Los eventos salen solos del catálogo; el admin solo sube fotos desde
-- /admin/entradas → "Fotos del carrusel". Una foto es de toda una competición
-- (evento null: la usan los partidos sin foto propia, alternándose) o de un
-- evento puntual (competicion + evento, igual que agrupa buildEvents()).
-- Varias fotos por grupo; `orden` decide cuál va primero. El tope de 10 por
-- grupo lo controla /api/carrusel/fotos.
--
-- Las fotos llegan ya encuadradas a 4:3 (1200×900) desde el panel y viven en
-- el bucket público `carrusel`. Lectura pública como el catálogo (la home las
-- lee con la anon key); escritura solo service role desde la API.

create table if not exists public.fotos_carrusel (
  id uuid primary key default gen_random_uuid(),
  competicion text not null check (length(competicion) between 1 and 200),
  evento text check (evento is null or length(evento) between 1 and 200),
  imagen_url text not null,
  orden int not null default 0,
  subida_por text,
  created_at timestamptz not null default now()
);

create index if not exists fotos_carrusel_grupo_idx
  on public.fotos_carrusel (competicion, evento, orden);

alter table public.fotos_carrusel enable row level security;

-- La home solo necesita estas columnas; `subida_por` (email del admin) no sale.
revoke all on public.fotos_carrusel from public, anon, authenticated;
grant select (id, competicion, evento, imagen_url, orden) on public.fotos_carrusel to anon;

drop policy if exists fotos_carrusel_select_anon on public.fotos_carrusel;
create policy fotos_carrusel_select_anon
  on public.fotos_carrusel
  for select
  to anon
  using (true);

-- Bucket público para servir las fotos (lectura anónima por URL pública;
-- escritura solo service role, que ignora RLS de storage). Mismo criterio que
-- `mapas` (0016), pero separado: estas fotos se borran desde el panel.
insert into storage.buckets (id, name, public)
values ('carrusel', 'carrusel', true)
on conflict (id) do nothing;
