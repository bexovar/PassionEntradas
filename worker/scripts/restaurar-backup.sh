#!/usr/bin/env bash
# Restaura un backup del worker en una base de Supabase (lo ideal: un proyecto
# nuevo). Se corre DENTRO del contenedor, que trae pg_restore:
#
#   docker exec -it passion-entradas-worker bash scripts/restaurar-backup.sh \
#     "postgresql://postgres.<ref>@<host>.pooler.supabase.com:5432/postgres" [archivo.dump]
#
# Sin archivo usa el último de $BACKUP_DIR. Si el URI no trae la contraseña,
# la pide. Nunca borra nada (no usa --clean): en una base con datos, lo que ya
# existe da error y queda como estaba.
set -euo pipefail

DESTINO="${1:?Uso: restaurar-backup.sh <URI de la base destino> [passion-AAAA-MM-DD_HHMM.dump]}"
DIR="${BACKUP_DIR:-/backups}"

if [ -n "${2:-}" ]; then
  PRINCIPAL="$2"
  [[ "$PRINCIPAL" == */* ]] || PRINCIPAL="$DIR/$PRINCIPAL"
else
  PRINCIPAL=$(ls -1 "$DIR"/passion-*_[0-9][0-9][0-9][0-9].dump 2>/dev/null | sort | tail -n 1 || true)
fi
[ -n "$PRINCIPAL" ] && [ -f "$PRINCIPAL" ] || { echo "No encontré el backup (${PRINCIPAL:-$DIR vacío})." >&2; exit 1; }
AUTH="${PRINCIPAL%.dump}.auth.dump"
[ -f "$AUTH" ] || { echo "Falta $AUTH (los logins de ese backup)." >&2; exit 1; }

if [ -z "${PGPASSWORD:-}" ] && ! [[ "$DESTINO" =~ ^postgres(ql)?://[^:@/]+:[^@/]*@ ]]; then
  read -rsp "Contraseña de la base destino: " PGPASSWORD; echo
  export PGPASSWORD
fi

HOST=$(sed -E 's#^[a-z]+://([^@]*@)?([^:/?]+).*#\2#' <<<"$DESTINO")
echo "Backup:  $(basename "$PRINCIPAL") (+ $(basename "$AUTH"))"
echo "Destino: $HOST"
read -rp "Escribí SI para restaurar: " OK
[ "$OK" = "SI" ] || { echo "Cancelado."; exit 1; }

# Supabase da a anon/authenticated/service_role permisos por defecto sobre todo
# lo nuevo en public. Restaurando con eso prendido, las funciones que el backup
# tiene cerradas (p.ej. stock_operacion) quedarían abiertas: se apagan mientras
# se restaura y se vuelven a prender al final, pase lo que pase.
defaults() {
  local accion=$1 prep=$2
  psql "$DESTINO" -v ON_ERROR_STOP=1 -q <<SQL
alter default privileges for role postgres in schema public $accion all on tables $prep anon, authenticated, service_role;
alter default privileges for role postgres in schema public $accion all on sequences $prep anon, authenticated, service_role;
alter default privileges for role postgres in schema public $accion all on functions $prep anon, authenticated, service_role;
SQL
}
defaults revoke from
trap 'defaults grant to && echo "Permisos por defecto de Supabase restaurados."' EXIT

errores=0
echo "1/2 Logins (auth.users, auth.identities)..."
pg_restore --data-only --no-owner --dbname "$DESTINO" "$AUTH" || errores=1
echo "2/2 Tablas, datos, funciones y permisos de public..."
pg_restore --no-owner --dbname "$DESTINO" "$PRINCIPAL" || errores=1

if [ "$errores" = 1 ]; then
  echo
  echo "Terminó con errores (arriba). 'schema \"public\" already exists' es normal;"
  echo "cualquier otro, revisalo antes de apuntar la app a esta base."
else
  echo "Listo, sin errores."
fi
