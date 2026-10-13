# PassionEntradas — worker de sincronización

Worker en **Node.js 20 + TypeScript** que sincroniza periódicamente **stock y precios**
desde el portal de agentes de Passion Events, les aplica un **markup del 20 %** y
publica el resultado en **Supabase (Postgres)** para que tu front (Next.js) muestre
disponibilidad y precios actualizados.

> ⚠️ **Antes de usar esto, leé la sección [Riesgos](#riesgos).** El problema técnico se
> resuelve con buen diseño; el riesgo real es de **Términos de Servicio / cuenta**.
> La vía sólida y duradera es pedirle a Passion Events una **API/feed de agentes**
> (Camino A oficial). Si te la dan, todo esto se vuelve trivial y sin riesgo de suspensión.

---

## Arquitectura

```
[Passion Events Booking System  ·  /admin/ (PHP server-side)]
        | login (1 vez, Playwright) -> sesión persistida (storageState)
        | sync cada SYNC_INTERVAL_MS:
        |   1. ensureSession()         -> re-login si expiró
        |   2. GET event_list.php      -> eventos (book / on_request)
        |   3. book: GET event_detail.php (1 x evento, con throttle)
        |            -> 1 fila por sector (precio + stock de inputs hidden)
        |      on_request: 1 fila sin precio (disponible=false)
        |   4. validar (zod)           -> descartar inválidos
        |   5. guard anti-borrado      -> abortar si caída sospechosa
        |   6. markup 20% (+ conversión opcional EUR->ARS)
        |   7. upsert por lotes en Supabase
        |   8. marcar ausentes (solo si el scrape fue completo)
        v
   [Supabase Postgres] <--(SELECT, anon key + RLS)-- [Next.js front]
```

### Estructura

```
src/
  config/      Config validada con zod (.env)
  portal/
    parser.ts  ⭐ ÚNICO punto de acoplamiento: parseEventList + parseEventDetail
    session.ts Login + storageState (Playwright); detecta expiración y captcha
    client.ts  GET de páginas HTML del portal (undici) reusando la cookie
    scrape.ts  Orquesta lista + detalle (book/on_request, throttle, completeness)
    types.ts   Validación zod del input no confiable del portal
  pricing/     Markup + conversión (función pura, testeada; null para on_request)
  db/          Cliente Supabase + repositorio (upsert / anti-borrado)
  sync/
    partial-guard.ts  Regla anti-borrado (pura, testeada)
    cycle.ts          Un ciclo completo de sync
  backup/      Backup diario de la base (pg_dump)
  health.ts    Servidor /healthz interno
  index.ts     Loop single-flight + manejo de señales (SIGTERM/SIGINT)
scripts/
  restaurar-backup.sh        Restaura un backup (ver "Backup de la base")
db/
  migrations/0001_init.sql   Esquema + RLS
  apply.ts                   Aplica migraciones (pg + SUPABASE_DB_URL)
test/fixtures/               event_list.html + event_detail.html (HTML real del portal)
```

---

## Cómo lee el portal (ya adaptado al portal real)

El portal es el **Passion Events Booking System** (PHP server-side bajo `/admin/`).
No hay API JSON: los datos vienen en el HTML. El parser ya está adaptado a esa
estructura real (capturada de `event_list.php` y `event_detail.php`):

- **`event_list.php`** → tabla `Title | Sub Category | Start | Location | Available
  Seats | Action`. El **tipo** se infiere de la URL del link:
  - `event_detail.php?event_id=N`  → **"book"** (tiene precio, comprable).
  - `event_detail_request.php?event_id=N` → **"on_request"** (sin precio, contacto).
- **`event_detail.php`** (book) → tabla de sectores. Precio y stock se leen de los
  **inputs hidden** `unit_price[]` y `available_seats[]` (más estable que el texto);
  el id de sector sale de `seat_cat_id[]`. Cada sector = una fila en `tickets`
  (`id = <event_id>::<seat_cat_id>`).

### Modelo de datos resultante

| estado | precio | disponible | uso en el front |
|---|---|---|---|
| `book` | sí (×1.20) | `seats > 0` | mostrar precio y permitir compra |
| `on_request` | `null` | `false` | mostrar "Consultar" (WhatsApp/mail) |

Todo lo específico del portal vive **solo** en
[`src/portal/parser.ts`](src/portal/parser.ts): si cambia el layout, se arregla en un
único archivo (y se actualizan los fixtures de `test/`).

> **Lo único pendiente de confirmar:** los **selectores del formulario de login**
> (`PORTAL_SELECTORS` en `parser.ts`) son best-effort, porque la captura se hizo ya
> logueado. Si el login automático falla, ajustá `userInput`/`passInput`/`submit` con
> lo que veas en la página de login (`PE_LOGIN_URL`).

---

## Setup local

Requisitos: Node.js 20+.

```bash
cp .env.example .env      # completá credenciales y claves
npm install
npx playwright install chromium   # solo para correr fuera de Docker

npm run typecheck
npm test                  # tests de pricing, parser y anti-borrado
npm run build
npm start                 # corre el worker (necesita .env válido + Supabase)
```

### Probar sin publicar (dry-run)

Para verificar que el scraper **toma bien los datos de los ~100 eventos SIN tocar
Supabase**: con `PE_USER`/`PE_PASS` en `.env`, corré:

```bash
npm install
npx playwright install chromium
npm run dry-run
```

Loguea, recorre lista + detalles, parsea y aplica el markup, e **imprime** un
resumen (book / on_request, precios, stock, sectores) + escribe el detalle completo
en `dry-run-output.json` para que lo revises. No escribe en la base. Si el **login
automático** falla, ajustá `PORTAL_SELECTORS`/`PE_LOGIN_URL` (ver sección del parser).

### Aplicar la migración a Supabase

Tres opciones:

```bash
# A) Script incluido (pg). Necesita el connection string de Postgres:
SUPABASE_DB_URL="postgres://postgres:...@db.<ref>.supabase.co:5432/postgres" npm run db:migrate

# B) Supabase Studio: pegá db/migrations/0001_init.sql en el SQL Editor.

# C) Supabase CLI:
supabase db push
```

---

## Deploy con Docker (Ubuntu + Portainer + Watchtower)

```bash
# En el server, con el .env presente junto al docker-compose.yml:
docker compose up -d --build
docker compose logs -f worker
```

- El front Next.js **no** se deploya acá.
- `storageState` (cookies de sesión) se persiste en el volumen `pe_state` para
  sobrevivir reinicios.
- Usuario **no-root** (`pwuser`), `no-new-privileges`, logs rotados.
- **Watchtower**: el contenedor está etiquetado para auto-update.
- Healthcheck: Docker ejecuta `dist/healthcheck.js` contra `/healthz` interno.

---

## Backup de la base

El plan Free de Supabase no tiene backups restaurables, así que el worker hace uno
por día con `pg_dump` (viene en la imagen). Se prende poniendo `BACKUP_DB_URL` en
`.env` (ver [`.env.example`](.env.example): tiene que ser el **Session pooler**).

- Corre una vez por día desde las `BACKUP_HOUR` (4 AM, hora de Argentina). Con la
  carpeta vacía (recién instalado) hace uno enseguida.
- Cada backup son dos archivos en el volumen `pe_backups` (`/backups`):
  - `passion-AAAA-MM-DD_HHMM.dump`: tablas, datos, funciones, RLS y permisos de
    `public`, más el historial de migraciones.
  - `passion-AAAA-MM-DD_HHMM.auth.dump`: los logins (`auth.users`, `auth.identities`).
- Se guardan `BACKUP_KEEP_DAYS` días (14). Los viejos se borran solo después de un
  backup exitoso.
- Si falla, queda en el log (`backup de la base falló`, con el motivo) y se
  reintenta en una hora. Nunca frena el sync.
- **No incluye** las imágenes de Storage (los mapas). Restaurado en otro proyecto,
  `tickets.imagen_url` sigue apuntando al proyecto viejo. Si ese ya no existe, con
  `update tickets set imagen_url = null where source = 'portal';` el worker vuelve
  a bajar los mapas de Passion. Los subidos a mano para entradas propias se pierden.

```bash
docker compose logs worker | grep backup                    # cómo vienen
docker exec passion-entradas-worker ls -la /backups         # qué hay
docker cp passion-entradas-worker:/backups ./backups-copia  # copia fuera del volumen
```

### Restaurar

Lo más seguro es restaurar en un **proyecto de Supabase nuevo** y después apuntar
la app (y este `.env`) a ese proyecto. Con el URI del Session pooler del destino
(sin la contraseña: el script la pide):

```bash
docker exec -it passion-entradas-worker bash scripts/restaurar-backup.sh \
  "postgresql://postgres.<ref>@aws-0-<region>.pooler.supabase.com:5432/postgres"
# Otro backup que no sea el último: agregá el nombre del archivo como segundo argumento.
```

Restaura primero los logins y después `public`, con los mismos permisos que tenía
la base (apaga mientras tanto los permisos por defecto que Supabase da a `anon`
sobre lo nuevo, y los vuelve a prender). No borra nada: en una base con datos, lo
que ya existe da error y queda como estaba. Un error `schema "public" already
exists` es normal.

---

## Variables de entorno

Ver [`.env.example`](.env.example) para la lista completa y comentada.

| Variable | Default | Descripción |
|---|---|---|
| `PE_USER` / `PE_PASS` | — | Credenciales de **tu** cuenta de agente (secreto). |
| `PE_BASE_URL` | `https://passioneventsonline.eu/admin/` | Base del portal (admin). |
| `PE_LOGIN_URL` | (= base) | Página de login si difiere del index. |
| `PE_EVENT_LIST_PATH` | `event_list.php` | Listado de eventos. |
| `PE_SYNC_CATEGORIES` | (todas) | Filtro por Sub Category/Título (lista CSV). |
| `PE_INCLUDE_ON_REQUEST` | `true` | Incluir eventos sin precio como `disponible=false`. |
| `PE_DETAIL_THROTTLE_MS` | `1000` | Pausa entre fetches de detalle (cortesía). |
| `PE_MAX_DETAILS_PER_CYCLE` | `0` | Tope de detalles por ciclo (0 = sin límite). |
| `PRICE_MARKUP` | `0.20` | Markup fijo (+20 %). |
| `CONVERT_TO_ARS` | `false` | Si `true`, convierte EUR→ARS. |
| `EUR_ARS_RATE` | — | Tasa EUR→ARS (obligatoria si conversión `true`). |
| `ARS_ROUND_TO` | `100` | Redondeo ARS (100 = al cien; 1 = entero). |
| `SYNC_INTERVAL_MS` | `300000` | Espera **entre** ciclos (5 min; N+1 por detalle). |
| `SYNC_DROP_ABORT_RATIO` | `0.7` | Aborta si la cantidad cae más que esto vs. último sync. |
| `SUPABASE_URL` | — | URL del proyecto Supabase. |
| `SUPABASE_SERVICE_ROLE_KEY` | — | **service_role** (secreto, solo en el worker). |
| `SUPABASE_DB_URL` | — | Connection string Postgres (solo migraciones). |
| `BACKUP_DB_URL` | — | URI del Session pooler para el backup diario. Vacío = sin backup. |
| `BACKUP_KEEP_DAYS` | `14` | Días de backups que se guardan. |
| `BACKUP_HOUR` | `4` | Hora de Argentina desde la que corre el backup del día. |
| `STATE_DIR` | `/data` | Dónde persistir `storageState`. |
| `HEALTH_PORT` | `8080` | Puerto de `/healthz`. |

---

## Regla de markup

```
precio_final = round( precio_origen * (1 + PRICE_MARKUP) * tasaConversion )
```

- Sin conversión: `tasaConversion = 1`, `moneda_final = 'EUR'`, redondeo a **2 decimales**.
- Con `CONVERT_TO_ARS=true`: `tasaConversion = EUR_ARS_RATE`, `moneda_final = 'ARS'`,
  redondeo al **múltiplo `ARS_ROUND_TO`** (default 100).
- Eventos **`on_request`**: no tienen precio de origen → `precio_final = null`
  (no hay nada que markupear).

Se guardan **siempre** `precio_origen` y `precio_final` por separado (trazabilidad).

---

## Robustez

- **Loop single-flight**: el `while + await` garantiza que dos ciclos nunca se solapen
  aunque el portal tarde. No usa `cron` del SO (no baja de 1 min).
- **Anti-borrado** (crítico): jamás `delete` masivo. Un ítem ausente se marca
  `disponible=false`/`stock=0`, **solo si el sync fue exitoso y completo**. Si el sync
  trae 0 ítems o cae más de `SYNC_DROP_ABORT_RATIO` respecto del último exitoso, se
  **aborta el update** y se preservan los datos viejos.
- **Sesión**: login una vez, `storageState` reusado y persistido en volumen. Re-login
  ante expiración (redirect a login / 401 / 403), con backoff.
- **Captcha/MFA/bloqueo**: si aparece, **no se evade** — se loguea, se alerta y se enfría
  (`BLOCKED_COOLDOWN_MS`). Es señal de que el portal no quiere acceso automatizado.
- **Backoff** exponencial + jitter ante 429/5xx y fallos de login.
- **Validación zod** de todo lo extraído (input no confiable): fuerza numéricos, rechaza
  negativos/no-numéricos; los inválidos se descartan y se cuentan.
- **Shutdown limpio** con SIGTERM/SIGINT (cierra Playwright, flush de logs).
- **/healthz** para el healthcheck de Docker (stale si no hubo sync exitoso reciente).
- **Logging** con pino y **redacción** de credenciales/cookies/keys.

---

## Riesgos

### Legales y de cuenta (los más serios — verificalos vos)

- **ToS del portal**: automatizar login + scraping de `passioneventsonline.eu`
  **casi seguro viola sus términos**, aun con credenciales legítimas. Consecuencia
  realista: **suspensión de tu cuenta de agente**. Revisá los Legal Terms
  (<https://www.passionevents.eu/legal-terms>) y, si dudás, **pedí una integración
  oficial (Camino A)**. Esto **no** se arregla con código.
- **Acceso autorizado**: usá **solo tu propia** cuenta de agente. No compartas ni
  multipliques sesiones.
- **Reventa con markup**: revender como agente con tu margen es normal, pero la reventa
  de entradas está **regulada** en varios países (origen y destino). Cumplí tu contrato
  de agente y la normativa aplicable.
- **Datos de terceros / precios**: estás republicando precios e inventario de Passion
  Events. Confirmá en tu acuerdo que **podés mostrarlos públicamente con markup**.

### Seguridad de la aplicación

- Credenciales del portal y **service_role** de Supabase = **secretos**. Solo en el
  worker, vía `.env` fuera de git, **nunca** en el front ni en `NEXT_PUBLIC_*`. Si se
  filtra la service_role, alguien tiene acceso total a tu DB salteando RLS.
- **RLS** en `tickets`: el front (anon key) solo `SELECT`; `INSERT/UPDATE` solo con
  service_role (que saltea RLS).
- **Validá con zod** todo lo extraído del portal.
- **storageState/cookies** = secreto: volumen con permisos restringidos (`0600`), nunca
  en el repo, nunca en logs.
- Contenedor con usuario **no-root** y `no-new-privileges`.

### Técnicos del scraping

- **Cambio de layout**: rompe el parser → por eso está **aislado** y hay **detección de
  sync parcial** que evita publicar basura o vaciar el catálogo.
- **Expiración de sesión / re-login**: manejado. Si Passion Events agrega **MFA/CAPTCHA**,
  el sync **se cae por diseño** (y debe caerse, no evadirse).
- **Bloqueo por frecuencia**: 30 s es agresivo contra un portal B2B. Si ves 429s, subí
  `SYNC_INTERVAL_MS` (60 000–120 000).
- **Datos stale**: mostrá `updated_at` en el front para que se note si los precios
  quedaron viejos.

> **Resumen honesto:** el verdadero *breach* acá no es técnico sino de **ToS/cuenta**.
> La vía robusta es una **API/feed oficial de agentes** de Passion Events.
