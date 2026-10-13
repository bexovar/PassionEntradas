-- =============================================================================
-- Reconciliación: mitad sobreviviente de `rpc_revocar_public` (aplicada el
-- 2026-07-13 directo contra Supabase, nunca llegó al repo).
--
-- `0015_rpc_solo_service_role` revoca EXECUTE a anon y authenticated, pero eso
-- no alcanza: Postgres le otorga EXECUTE a PUBLIC por default al crear una
-- función, y anon lo hereda igual desde ahí. Sin este revoke, una base
-- reconstruida desde cero deja `validar_orden_hitos()` —SECURITY DEFINER—
-- ejecutable por cualquiera.
--
-- La otra mitad de aquella migración apuntaba a `recalcular_precios_portal()`
-- y ya quedó cubierta por `0017_perf_panel`, que dropea la versión sin
-- argumentos, la recrea como (p_competicion text) y re-revoca sobre la firma
-- nueva. No hace falta repetirla acá.
--
-- Va en 0046 (y no junto a 0015, donde nació el problema) porque la función
-- se redefinió después (0032, 0034, 0040): `create or replace` conserva los
-- permisos, así que el revoke vale igual, y acá corre con la versión final.
--
-- YA ESTÁ APLICADA EN PRODUCCIÓN. Idempotente.
-- =============================================================================

revoke execute on function public.validar_orden_hitos() from public, anon, authenticated;
grant  execute on function public.validar_orden_hitos() to service_role;
