-- Registro de actividad de toda la app: quién cambió qué y cuándo.
--
-- Cada acción que cambia datos (marcar/desmarcar un paso, cotizar, aceptar,
-- cancelar, cargar o editar entradas, decidir un acceso, cambiar el equipo,
-- la configuración, ingresar o salir) deja una fila acá. Antes no había forma
-- de saber quién desmarcó un paso: al desmarcar se borraba también el "por",
-- y los logs de Supabase del plan Free pierden líneas.
--
-- `resumen` es la frase que se muestra ("Desmarcó «Pago recibido»");
-- `detalle` guarda los datos (antes/después, montos) SIN secretos: el helper
-- lib/actividad.ts borra contraseñas y tokens antes de insertar.
--
-- RLS deny-all como el resto: solo el servidor (service role) lee y escribe;
-- la pantalla Actividad y el historial de cada operación pasan por la API.

create table if not exists public.actividad (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  actor_nombre text,
  actor_rol text,
  accion text not null,
  entidad text,
  entidad_id text,
  codigo text,
  resumen text not null,
  detalle jsonb not null default '{}'::jsonb,
  origen text not null default 'panel'
);

create index if not exists actividad_created_idx on public.actividad (created_at desc);
create index if not exists actividad_entidad_idx on public.actividad (entidad, created_at desc);
create index if not exists actividad_entidad_id_idx on public.actividad (entidad_id);
create index if not exists actividad_codigo_idx on public.actividad (codigo) where codigo is not null;
create index if not exists actividad_actor_idx on public.actividad (actor_id, created_at desc);
create index if not exists actividad_op_idx on public.actividad ((detalle ->> 'operacion_id'));

alter table public.actividad enable row level security;
revoke all on public.actividad from public, anon, authenticated;
