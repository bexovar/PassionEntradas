-- =============================================================================
-- Reconciliación: migraciones del CRM (AdminTickets) aplicadas el 2026-07-10
-- directo contra Supabase, que nunca llegaron a este repo.
--
-- Origen: JoacoBenz/CRMTickets, migraciones 0003/0004/0005. En producción
-- figuran como `lockdown_rls_transiciones_auditoria`, `fix_function_search_path`
-- y `cuenta_debitar`.
--
-- Sin este archivo, una base reconstruida desde cero pierde la tabla de
-- auditoría `operacion_eventos`, el trigger de máquina de estados,
-- `operaciones.created_by` y `operaciones.cuenta_debitar`.
--
-- YA ESTÁ APLICADA EN PRODUCCIÓN. Existe para que el repo pueda reproducir el
-- esquema, no para volver a correrla. Es idempotente igual.
--
-- Va en 0008 (el único número libre) aunque cronológicamente cae entre 0006 y
-- 0007: ninguna de las dos depende de la otra, así que el orden no importa.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Deny-all en `operaciones`.
--    Se eliminan las policies del MVP (0001) y la lectura de authenticated:
--    un moderador logueado podía saltarse la API con su JWT y leer/escribir
--    directo contra PostgREST, incluidos cambios de estado inválidos. La
--    página pública sigue leyendo vía el RPC operacion_publica (security
--    definer, no depende de policies); paneles y APIs usan service role.
drop policy if exists "op_public_read"  on public.operaciones;
drop policy if exists "op_auth_read"    on public.operaciones;
drop policy if exists "op_admin_insert" on public.operaciones;
drop policy if exists "op_admin_update" on public.operaciones;
drop policy if exists "op_admin_delete" on public.operaciones;

-- RLS sigue habilitado (deny-all por defecto). Refuerzo por si acaso:
alter table public.operaciones enable row level security;

-- ---------------------------------------------------------------------------
-- 2) Máquina de estados validada en Postgres, para que la invariante no
--    dependa de quién escriba.
--      esperando_entrada -> entrada_recibida -> confirmada
--      no-terminal -> cancelada; cancelada -> esperando_entrada (reabrir)
create or replace function public.validar_transicion_status()
returns trigger
language plpgsql
as $$
begin
  -- Updates que no tocan el estado pasan de largo.
  if new.status = old.status then
    return new;
  end if;

  if (old.status = 'esperando_entrada' and new.status in ('entrada_recibida', 'cancelada'))
     or (old.status = 'entrada_recibida' and new.status in ('confirmada', 'cancelada'))
     or (old.status = 'cancelada' and new.status = 'esperando_entrada')
  then
    return new;
  end if;

  raise exception 'Transición de estado no permitida: % -> %', old.status, new.status
    using errcode = 'P0001';
end;
$$;

drop trigger if exists trg_operaciones_validar_status on public.operaciones;
create trigger trg_operaciones_validar_status
  before update of status on public.operaciones
  for each row
  execute function public.validar_transicion_status();

-- ---------------------------------------------------------------------------
-- 3) Quién creó cada operación + historial de cambios de estado.
alter table public.operaciones
  add column if not exists created_by uuid references auth.users (id);

create table if not exists public.operacion_eventos (
  id bigint generated always as identity primary key,
  operacion_id uuid not null references public.operaciones (id) on delete cascade,
  de operacion_status,                -- null = creación
  a operacion_status not null,
  actor_id uuid,
  actor_email text,
  created_at timestamptz not null default now()
);

create index if not exists operacion_eventos_op_idx
  on public.operacion_eventos (operacion_id, created_at);

-- Deny-all también acá: solo la service role lee/escribe la auditoría.
alter table public.operacion_eventos enable row level security;

-- ---------------------------------------------------------------------------
-- 4) "Cuenta a debitar": de qué cuenta (alias/CBU) se debita la plata. Dato
--    interno del panel — NO se expone en el RPC público.
alter table public.operaciones
  add column if not exists cuenta_debitar text;

-- ---------------------------------------------------------------------------
-- 5) search_path fijo en las funciones de trigger (advisor 0011): evita que un
--    search_path manipulado redirija referencias dentro de la función.
alter function public.set_updated_at() set search_path = public;
alter function public.validar_transicion_status() set search_path = public;
