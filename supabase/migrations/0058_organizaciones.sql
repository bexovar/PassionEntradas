-- TKT-10: organizaciones y usuarios.
--
-- Cada usuario cliente pertenece a UNA organización (agencia, operador,
-- hotel, freelance…) con un rol: 'admin' ve todos los pedidos de la
-- organización, 'vendedor' ve los suyos. El freelance es una organización de
-- un solo usuario.
--
-- La organización se arma al APROBAR la solicitud (que ya es manual): el CUIT
-- de la solicitud (TKT-11) se compara con el de las organizaciones existentes
-- y quien aprueba confirma el match (entra como vendedor) o crea una nueva
-- (entra como admin). Nunca se asocia solo por CUIT: el CUIT es público.
--
-- Toda operación y consulta queda con su organizacion_id: lo pone un trigger
-- a partir del cliente_id, así no depende de que cada ruta se acuerde.
--
-- Dos organizaciones duplicadas (errores de tipeo) se fusionan con
-- fusionar_organizaciones(): mueve usuarios, operaciones, consultas y
-- solicitudes al destino y deja el origen marcado como fusionado (no se borra,
-- queda el rastro).
--
-- ORDEN: después de 0052 (TKT-11: tipo y nombre de organización en la
-- solicitud). Número 0058 porque 0055–0057 son de TKT-14, TKT-21 y TKT-18.
-- Aplicar ANTES de deployar el código de TKT-10.
--
-- RLS deny-all como el resto: todo se lee y escribe con service role desde
-- las API routes, que controlan quién ve qué.

create table if not exists public.organizaciones (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (length(btrim(nombre)) between 1 and 120),
  tipo text check (tipo is null or tipo in ('agencia', 'operador', 'freelance', 'hoteleria', 'otro')),
  -- Solo los 11 dígitos, para comparar sin importar guiones. NULL en las
  -- migradas sin CUIT válido.
  cuit text check (cuit is null or cuit ~ '^\d{11}$'),
  fusionada_en uuid references public.organizaciones(id),
  fusionada_at timestamptz,
  fusionada_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fusionada_en is null or fusionada_en <> id)
);

alter table public.organizaciones enable row level security;

drop trigger if exists organizaciones_updated_at on public.organizaciones;
create trigger organizaciones_updated_at
  before update on public.organizaciones
  for each row execute function public.set_updated_at();

create index if not exists organizaciones_cuit_idx
  on public.organizaciones (cuit) where fusionada_en is null;
create index if not exists organizaciones_fusionada_en_idx
  on public.organizaciones (fusionada_en);

-- Un usuario, una organización (un usuario por email, y el email es personal).
create table if not exists public.organizacion_miembros (
  user_id uuid primary key,
  organizacion_id uuid not null references public.organizaciones(id),
  rol text not null check (rol in ('admin', 'vendedor')),
  -- Para mostrar quién cargó cada pedido sin ir a Auth.
  nombre text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.organizacion_miembros enable row level security;

drop trigger if exists organizacion_miembros_updated_at on public.organizacion_miembros;
create trigger organizacion_miembros_updated_at
  before update on public.organizacion_miembros
  for each row execute function public.set_updated_at();

create index if not exists organizacion_miembros_org_idx
  on public.organizacion_miembros (organizacion_id);

alter table public.operaciones
  add column if not exists organizacion_id uuid references public.organizaciones(id);
alter table public.consultas
  add column if not exists organizacion_id uuid references public.organizaciones(id);
alter table public.solicitudes_acceso
  add column if not exists organizacion_id uuid references public.organizaciones(id);

create index if not exists operaciones_organizacion_idx
  on public.operaciones (organizacion_id, created_at desc);
create index if not exists consultas_organizacion_idx
  on public.consultas (organizacion_id, created_at desc);
create index if not exists solicitudes_acceso_organizacion_idx
  on public.solicitudes_acceso (organizacion_id);

-- La organización de la operación/consulta sale de su cliente.
create or replace function public.asignar_organizacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cliente_id is not null
     and (tg_op = 'INSERT' or new.cliente_id is distinct from old.cliente_id)
     and (new.organizacion_id is null or tg_op = 'UPDATE') then
    select m.organizacion_id into new.organizacion_id
      from public.organizacion_miembros m
     where m.user_id = new.cliente_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.asignar_organizacion() from public, anon, authenticated;
grant execute on function public.asignar_organizacion() to service_role;

drop trigger if exists operaciones_organizacion on public.operaciones;
create trigger operaciones_organizacion
  before insert or update of cliente_id on public.operaciones
  for each row execute function public.asignar_organizacion();

drop trigger if exists consultas_organizacion on public.consultas;
create trigger consultas_organizacion
  before insert or update of cliente_id on public.consultas
  for each row execute function public.asignar_organizacion();

-- Fusión de duplicadas: todo lo del origen pasa al destino, en una sola
-- transacción. Los roles se conservan (un admin del origen sigue siendo admin).
create or replace function public.fusionar_organizaciones(p_origen uuid, p_destino uuid, p_por text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  movidas integer;
begin
  if p_origen = p_destino then
    raise exception 'Elegí dos organizaciones distintas' using errcode = 'P0001';
  end if;
  perform 1 from public.organizaciones where id = p_origen and fusionada_en is null for update;
  if not found then
    raise exception 'La organización de origen no existe o ya fue fusionada' using errcode = 'P0001';
  end if;
  perform 1 from public.organizaciones where id = p_destino and fusionada_en is null for update;
  if not found then
    raise exception 'La organización de destino no existe o ya fue fusionada' using errcode = 'P0001';
  end if;

  update public.organizacion_miembros set organizacion_id = p_destino where organizacion_id = p_origen;
  update public.operaciones set organizacion_id = p_destino where organizacion_id = p_origen;
  get diagnostics movidas = row_count;
  update public.consultas set organizacion_id = p_destino where organizacion_id = p_origen;
  update public.solicitudes_acceso set organizacion_id = p_destino where organizacion_id = p_origen;
  update public.organizaciones
     set fusionada_en = p_destino, fusionada_at = now(), fusionada_por = p_por
   where id = p_origen;
  return movidas;
end;
$$;

revoke execute on function public.fusionar_organizaciones(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fusionar_organizaciones(uuid, uuid, text) to service_role;

-- Backfill: cada cliente aprobado que ya existe queda en su propia
-- organización, como admin (freelance hasta que se fusione con su agencia).
-- Idempotente: salta a quien ya es miembro.
do $$
declare
  s record;
  org uuid;
  digitos text;
begin
  for s in
    select distinct on (sa.user_id)
           sa.id, sa.user_id, sa.nombre, sa.email, sa.legajo, sa.organizacion, sa.tipo_organizacion
      from public.solicitudes_acceso sa
      join auth.users u on u.id = sa.user_id
     where sa.estado = 'aprobada'
       and sa.user_id is not null
       and coalesce(u.raw_app_meta_data->>'role', '') = 'cliente'
       and not exists (select 1 from public.organizacion_miembros m where m.user_id = sa.user_id)
     order by sa.user_id, sa.decidida_at desc nulls last
  loop
    digitos := regexp_replace(coalesce(s.legajo, ''), '\D', '', 'g');
    insert into public.organizaciones (nombre, tipo, cuit)
    values (
      left(coalesce(nullif(btrim(s.organizacion), ''), nullif(btrim(s.nombre), ''), s.email), 120),
      s.tipo_organizacion,
      case when digitos ~ '^\d{11}$' then digitos end
    )
    returning id into org;
    insert into public.organizacion_miembros (user_id, organizacion_id, rol, nombre, email)
    values (s.user_id, org, 'admin', s.nombre, s.email);
    update public.solicitudes_acceso set organizacion_id = org where id = s.id;
  end loop;
end;
$$;

-- monto > 0: el check NOT VALID operaciones_monto_positivo rechaza cualquier
-- UPDATE de una fila con monto 0 (mismo criterio que 0040 y 0056).
update public.operaciones o
   set organizacion_id = m.organizacion_id
  from public.organizacion_miembros m
 where o.cliente_id = m.user_id
   and o.organizacion_id is null
   and o.monto > 0;

update public.consultas c
   set organizacion_id = m.organizacion_id
  from public.organizacion_miembros m
 where c.cliente_id = m.user_id
   and c.organizacion_id is null;
