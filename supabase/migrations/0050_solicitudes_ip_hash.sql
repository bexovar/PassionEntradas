-- =============================================================================
-- 0050 — límite de solicitudes de acceso por IP.
--
-- /api/acceso/solicitar es público y cada solicitud nueva avisa a todo el
-- equipo por WhatsApp y email. Para poder topear por origen se guarda un hash
-- de la IP (no la IP: con el hash alcanza para contar, y es menos PII).
-- La app cuenta las de la última hora (ver lib/acceso.ts).
--
-- Idempotente. Las solicitudes viejas quedan con ip_hash null.
-- =============================================================================

alter table public.solicitudes_acceso
  add column if not exists ip_hash text;

create index if not exists solicitudes_acceso_ip_idx
  on public.solicitudes_acceso (ip_hash, created_at desc)
  where ip_hash is not null;
