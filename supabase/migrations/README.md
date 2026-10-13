# Migraciones

Estas migraciones son la **única** fuente de verdad del esquema. Aplicarlas en
orden sobre una base vacía tiene que reproducir producción.

## Reglas

1. **Nunca** aplicar SQL directo contra producción (dashboard, MCP, psql) sin
   dejar el archivo acá, en el mismo commit. Así se perdieron cuatro
   migraciones entre julio y septiembre de 2026: una base reconstruida quedaba
   sin `operacion_eventos`, sin el trigger de máquina de estados de
   `operaciones` y sin `operaciones.cuenta_debitar`, y nadie se enteraba
   porque producción estaba bien.

2. Un archivo por cambio, numerado `NNNN_nombre.sql`, idempotente
   (`if not exists` / `or replace` / `drop ... if exists`).

3. **Los GRANT/REVOKE van en la misma migración que define la función.**
   Un revoke escrito contra `f()` no protege a `f(text)`: en Postgres cambiar
   la lista de argumentos crea una función nueva, y una función nueva nace con
   `EXECUTE` para `PUBLIC`. Comparar `0017_perf_panel` (lo hace bien: dropea,
   recrea y revoca en el mismo archivo) contra `0015` + `0046`, que es el
   parche que hizo falta porque el revoke quedó huérfano de su firma.

4. Revocar de `public`, no solo de `anon, authenticated`. `anon` hereda el
   EXECUTE desde PUBLIC, así que revocarle a él solo no cierra nada.

## Estado actual

`0001` y `0002` están aplicadas en producción pero **no** registradas en
`supabase_migrations.schema_migrations`: son anteriores a que existiera el
tracking. Si linkeás el CLI, marcalas como aplicadas en vez de correrlas:

```bash
supabase migration repair --status applied 0001 0002
```

El resto sí está registrado (con nombres que no siempre coinciden con el del
archivo: `operacion_monto_positivo`, por ejemplo, es parte de `0032`).

`0008`, `0046` y `0047` son la reconciliación de lo que se aplicó directo en
producción y nunca llegó al repo: `0008` y `0046` ya están aplicadas allá;
`0047` (borra `admin_auth`) se aplica junto con el merge de este cambio.
