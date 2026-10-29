# Modelo de amenazas (STRIDE): TicketMirror

- **Fecha:** 2026-10-28
- **Alcance:** toda la app: tienda, panel de admin y moderador, API, Supabase (RLS, RPC y storage), worker y flujo de pedidos y cobro.
- **Base:** el código de `main` (`6a22ea9`), más consultas de solo lectura a producción (proyecto `vcovindqjrzpkoxandnv`) y los avisos de seguridad de Supabase.

> Es un documento vivo. Conviene revisarlo antes de activar el **cobro al confirmar**, porque ese cambio sube el impacto de varias amenazas (T1, R3).

---

## 1. El sistema

### 1.1 Qué es
Plataforma B2B de entradas para agencias y agentes de viajes:
- **Acceso:** una solicitud que el admin aprueba.
- **Tienda privada:** catálogo, pedidos y consultas con cotización.
- **Panel interno:** roles administrador y moderador, para gestionar operaciones, cobros y entregas.
- **Worker:** sincroniza el catálogo desde el portal del proveedor.

### 1.2 Flujo de datos
```
                 ┌──────────────── Internet (no confiable) ────────────────┐
 [Visitante] ──► /  /legal  /op/[id]  /factura/[id]  POST /api/acceso/solicitar
 [Agente]    ──► /entradas /mis-pedidos /cuenta ──► /api/pedidos, /api/mis-pedidos, /api/consultas
 [Staff]     ──► /admin /moderador ──► /api/operaciones, /api/tickets, /api/acceso, /api/equipo ...
 [Cualquiera con la anon key] ──► Supabase PostgREST (RPC públicas, tickets, config)
                 └──────────────────────────────┬─────────────────────────┘
                                                │ ─ ─ límite: Next.js (Vercel)
                                   [App Next.js: middleware + API routes]
                                   (service role, salta la RLS)
                                                │ ─ ─ límite: datos
                                   [Supabase: Postgres + Auth + Storage]
                                                ▲
 [Portal del proveedor] ──HTML──► [Worker Docker: Playwright + service role] ──► /api/revalidar, /api/recordatorios
                                                │
                     [Meta WhatsApp API]  [Resend email]  ◄── notificaciones de la app
```

### 1.3 Límites de confianza
1. **Navegador → app:** toda entrada del cliente es no confiable. La sesión es una cookie de Supabase (`SameSite=Lax`).
2. **Navegador → Supabase directo:** la anon key es pública porque viaja en el bundle. La RLS y los grants son la única barrera.
3. **App → Supabase:** casi todo pasa por la service role. La autorización vive en el código TypeScript de cada ruta, no en la base.
4. **Portal del proveedor → worker:** el HTML del proveedor es una fuente externa.
5. **Worker → app:** se autentica con la service role key mandada como token.
6. **App → Meta y Resend:** la PII sale hacia terceros.

## 2. Activos

| Activo | Sensibilidad | Dónde está |
|---|---|---|
| Service role key de Supabase | **Crítica** | Vercel, `.env` del worker, header de cada llamada del worker |
| Cuentas de staff (admin) | **Crítica** | Supabase Auth (`app_metadata.role`) |
| Montos, cobros y estados de pago | Alta | `operaciones`, `consultas`, `facturas` |
| Precios, costos y márgenes (el negocio) | Alta | `tickets` (precio_origen, precio_costo), `margenes`, `facturas.datos.fee` |
| PII de agentes y pasajeros | Alta | `solicitudes_acceso` (CUIT/CUIL, teléfono), `auth.users`, `actividad.detalle`, `notificaciones` |
| Datos de pago (texto con cuenta bancaria) | Alta | `textos_config` |
| Credenciales iniciales | Alta | Respuesta de la API, email de Resend, WhatsApp manual |
| Registro de auditoría | Media | `actividad`, `equipo_cambios`, columnas `*_por` |
| Sesión del portal del proveedor | Media | `/data/storageState.json` del worker |
| Backups | Alta | Volumen `pe_backups` en el host del worker, sin cifrar |

## 3. Análisis STRIDE

Puntaje = impacto × probabilidad, cada uno de 1 a 4. Riesgo: ≥12 crítico, ≥6 alto, ≥3 medio, menor a 3 bajo.

### 3.1 Spoofing (suplantación)

| ID | Amenaza | Evidencia | Imp. | Prob. | Riesgo |
|---|---|---|---|---|---|
| S1 | **Fuerza bruta o credential stuffing contra cuentas de staff.** La app no tiene rate limit propio, no hay MFA y está **apagada la protección de contraseñas filtradas** (aviso de Supabase). La única regla de contraseña es mínimo 8 caracteres, validada en el cliente. | `app/(tienda)/ingresar/page.tsx:60`; sin `auth.mfa` | 4 | 2 | **8 Alto** |
| S2 | **Contraseña inicial en texto plano por email** (queda en los logs de Resend) **y sin cambio obligatorio** en el primer ingreso. | `app/api/acceso/[id]/decidir/route.ts:199-219`, `app/api/equipo/route.ts:53-68,153-159` | 3 | 2 | **6 Alto** |
| S3 | **Solicitud con un email ajeno.** Nadie verifica que el email sea de quien lo pide. Al aprobar se crea el usuario con `email_confirm: true` y esa cuenta recibe las notificaciones que se cruzan por email. | `app/api/acceso/solicitar/route.ts`, `decidir/route.ts:149-156`, `app/api/notificaciones/route.ts:74-84` | 2 | 2 | 4 Medio |
| S4 | **Nombres falsificables.** `nombreDe()` usa `user_metadata`, que cada usuario edita. Esos nombres van a `*_por`, `comprador_alias` y `actor_nombre`, y deciden **a quién se avisa** (`vendedor_alias`). | `lib/auth.ts:52-58`, `lib/avisos-equipo.ts:46,222` | 2 | 2 | 4 Medio |
| S5 | **Una sesión robada pasa a ser una cuenta tomada.** La cookie no es `httpOnly` (default de `@supabase/ssr`) y la contraseña se cambia sin pedir la actual. No se encontró ningún punto de XSS, así que la probabilidad es baja. | `components/tienda/CuentaCliente.tsx:139`, `components/admin/CambiarClave.tsx:40`, `app/(tienda)/recuperar/page.tsx:54-89` | 3 | 1 | 3 Medio |

### 3.2 Tampering (manipulación)

| ID | Amenaza | Evidencia | Imp. | Prob. | Riesgo |
|---|---|---|---|---|---|
| T1 | **Pedido con el precio que pone el cliente.** Si el ítem llega sin `ticket_id`, o con uno que no existe, `reconciliarItem` deja el `evento` y el `monto` que mandó el cliente. Así se puede crear un pedido de "Final" por USD 1. Con el **cobro al confirmar**, un error del staff al confirmar se convierte en un cobro mal hecho. | `lib/pedidos.ts:79`, `app/api/pedidos/route.ts:181-198,229-232` | 3 | 3 | **9 Alto** |
| T2 | **Catálogo de demo en producción.** Si Supabase falla, `fetchTickets` sirve `MOCK_TICKETS`, con precios inventados y comprables. Además, si falla la lectura de `config`, `portal_activo` vuelve a `true` y la tasa cae a 1.08. | `lib/supabase/public.ts:37-45,110-114` | 3 | 2 | **6 Alto** |
| T3 | **El worker confía en el portal.** Precios sin tope de cordura. Arma URLs sin lista de hosts permitidos, así que **la cookie de sesión del portal se manda a cualquier host** que aparezca en el HTML (además de habilitar SSRF). Acepta SVG en los mapas. | `worker/src/portal/client.ts:29-38,94-103`, `imagen.ts:151,163` | 3 | 1 | 3 Medio |
| T4 | **Los pagos los marca un solo admin, sin segregación.** Desmarcar un pago pone en NULL `*_at` y `*_por`, y la historia queda solo en `actividad`. El update no está condicionado al estado que se leyó. | `app/api/operaciones/[id]/status/route.ts:157-159,222-225` | 3 | 1 | 3 Medio |
| T5 | **Inyección de fórmulas en el CSV.** El escape no cubre tab, CR ni espacios antes de `=`, y llegan al CSV campos que controla el cliente. | `app/api/operaciones/export/route.ts:39-45` | 2 | 1 | 2 Bajo |
| T6 | **CSRF.** No hay chequeo de `Origin` ni de `Content-Type`; la única defensa es `SameSite=Lax`. Hay POST sin cuerpo, como descartar o rechazar consultas. | todas las rutas con cookie | 2 | 1 | 2 Bajo |

### 3.3 Repudiation (repudio)

| ID | Amenaza | Evidencia | Imp. | Prob. | Riesgo |
|---|---|---|---|---|---|
| R1 | **Los eventos de seguridad los reporta el navegador o no se registran.** Ingreso, salida y cambio de clave llegan por `POST /api/actividad`, que cualquier usuario puede omitir o inventar. **No se registran** los logins fallidos, los pedidos de reset ni las **exportaciones CSV**. | `app/api/actividad/route.ts:24-70`, `export/route.ts` | 2 | 3 | **6 Alto** |
| R2 | **Auditoría frágil.** `actividad` se puede editar con la service role (no es append-only). El registro es best-effort: si el insert falla, la acción sigue igual. Las columnas `*_por` guardan nombres y no ids. `operacion_eventos` y `operaciones.created_by` nunca se escriben. | `lib/actividad.ts:128-131`, `0048_actividad.sql` | 2 | 2 | 4 Medio |
| R3 | **Cotización aceptada "por WhatsApp" sin prueba del cliente.** Cualquier miembro del staff, moderador incluido, la acepta con `p_cliente = null`. Con el cobro al confirmar y el derecho de arrepentimiento, conviene tener evidencia de la aceptación. | `app/api/consultas/[id]/aceptar/route.ts:71-75` | 2 | 2 | 4 Medio |

### 3.4 Information disclosure (exposición de información)

| ID | Amenaza | Evidencia | Imp. | Prob. | Riesgo |
|---|---|---|---|---|---|
| I1 | **`factura_publica` devuelve todo `datos`**, incluida la **comisión interna (`fee`)**, el email y el CUIT del comprador. Cualquiera con la anon key y el UUID puede llamarla, y además el comprobante enlaza al seguimiento. | `0019_facturas.sql:29-43`, `factura/route.ts:347-352` | 3 | 2 | **6 Alto** |
| I2 | **El cliente ve los teléfonos del equipo.** Si falla el WhatsApp, `/api/pedidos` le devuelve al cliente `whatsapp.error`, con los números y la respuesta cruda de Meta, y también `enviados`. | `app/api/pedidos/route.ts:664-666`, `lib/whatsapp.ts:296,314` | 2 | 3 | **6 Alto** |
| I3 | **Los precios "privados" son públicos para cualquiera con la anon key.** `catalogo_tienda` y los grants de `tickets` le dan a anon precio_final, stock y source, aunque la tienda pide login. El modelo de negocio ("ver el precio lleva a registrarse") depende de esto. | `0043_catalogo_tienda.sql:30`, `0013`, `0036` | 2 | 3 | **6 Alto** |
| I4 | **El link de seguimiento (`/op/[id]`), que se comparte en grupos**, muestra el nombre o el email del comprador y, en "para pagar", **los datos de pago** (`textos_config`). | `app/op/[id]/page.tsx:68-83`, `0042` | 2 | 2 | 4 Medio |
| I5 | **PII sin retención ni minimización.** `actividad.detalle` guarda la solicitud completa (CUIT, teléfono, mensaje). No hay purga. La PII sale hacia Meta y Resend. Además, la Ley 25.326 aplica. | `acceso/solicitar/route.ts:79`, `lib/actividad.ts:77` | 2 | 2 | 4 Medio |
| I6 | **Errores crudos de Postgres** (~35 lugares), algunos visibles para clientes. | `pedidos/route.ts:388,461`, `mis-pedidos/[id]/cancelar/route.ts:96,144` | 1 | 3 | 3 Medio |
| I7 | **Backups sin cifrar en el mismo host del worker**, con hashes de `auth.users` y sin copia externa. El plan Free de Supabase no hace backups. | `worker/src/backup/backup.ts:160-185` | 3 | 1 | 3 Medio |
| I8 | **No hay cabeceras de seguridad** (CSP, frame-ancestors, nosniff), así que el panel se puede embeber en otro sitio (clickjacking). | `next.config.mjs` | 2 | 1 | 2 Bajo |
| I9 | **Un staff desactivado sigue leyendo costos** directo de PostgREST con su JWT por hasta 1 h. Un cliente revocado no queda baneado. | `0027:39-45`, `revocar/route.ts:110-112` | 2 | 1 | 2 Bajo |
| I10 | **Datos del negocio en el repo:** el markup del 20%, la URL del portal, teléfonos y un token de admin viejo en el historial (la función ya está borrada). Si el repo es o fue público, el impacto sube. | `worker/src/config/index.ts:29`, commit `ad3bb5a` | 2 | 1 | 2 Bajo |

### 3.5 Denial of service (denegación de servicio)

| ID | Amenaza | Evidencia | Imp. | Prob. | Riesgo |
|---|---|---|---|---|---|
| D1 | **`/api/acceso/solicitar` no tiene rate limit ni captcha.** Cada email nuevo dispara un **WhatsApp y un email a todo el equipo**, lo que genera costo y spam, y el texto libre se reenvía tal cual: es un **canal de phishing hacia el staff**. | `app/api/acceso/solicitar/route.ts:26,40-91` | 2 | 3 | **6 Alto** |
| D2 | **El worker es un punto único de falla y no hay alertas.** Si cae, se congelan precios y stock, y paran los recordatorios y los **únicos backups**. | `worker/src/index.ts`, `health.ts` | 3 | 2 | **6 Alto** |
| D3 | **Dependencias vulnerables:** `next` 14.2.35 (1 crítica: envenenamiento de caché en middleware y RSC, y DoS) y, en el worker, `undici` 6.27.0 (bypass de validación TLS). Vercel instala con `npm install` y no con `npm ci`. | `npm audit`, `vercel.json:4` | 3 | 2 | **6 Alto** |
| D4 | **Flood de consultas.** Las consultas no cuentan para el límite de pedidos, y cada una avisa al equipo. El límite falla abierto si hay error de base. | `app/api/pedidos/route.ts:81-99`, `lib/pedidos.ts:154-173` | 2 | 2 | 4 Medio |
| D5 | **`catalogo_tienda` se puede llamar directo**, sin la caché de Next y con `p_hoy` a elección, y devuelve todo el catálogo. | `0043` | 2 | 2 | 4 Medio |
| D6 | **Truncamientos silenciosos:** el panel corta en 1000 filas y los recordatorios en 1000/500. | `app/admin/page.tsx:79`, `lib/avisos-equipo.ts:205,210` | 1 | 2 | 2 Bajo |

### 3.6 Elevation of privilege (elevación de privilegios)

| ID | Amenaza | Evidencia | Imp. | Prob. | Riesgo |
|---|---|---|---|---|---|
| E1 | **La service role key se usa como token de webhook.** El worker la manda cada ~5 min a `TIENDA_URL`, que acepta `http://`. Si se filtra, da control total: crear un admin, leer y modificar todo y cambiar contraseñas. Además, no se puede rotar por separado. | `worker/src/sync/revalidar.ts:172,198`, `config/index.ts:67`, `app/api/revalidar/route.ts` | 4 | 2 | **8 Alto** |
| E2 | **`MOCK_DATA=1` no tiene ningún resguardo de entorno.** Si se activa en producción, abre **todo** el panel y la API sin login, y la app **igual manda WhatsApp y email reales**. | `lib/mock-db.ts:37`, `middleware.ts:44-48`, ~40 rutas | 4 | 1 | 4 Medio* |
| E3 | **Un moderador ve más por API que en su pantalla:** la actividad y los avisos de **cualquier** operación (montos, emails), y puede aceptar cualquier cotización "por WhatsApp". | `app/api/operaciones/[id]/actividad`, `/avisos` | 2 | 2 | 4 Medio |
| E4 | **Registro público en Supabase Auth (no verificado).** Un usuario auto-registrado obtiene un JWT `authenticated`: sin rol no accede a nada, pero puede llamar `competiciones_catalogo`. | `lib/auth.ts:8-12`, `0020:26` | 2 | 1 | 2 Bajo |
| E5 | **`search_path` mutable en `validar_orden_hitos`** (aviso de Supabase). | `0007`/`0040` | 2 | 1 | 2 Bajo |

\* El puntaje de E2 es medio, pero el impacto es crítico y el arreglo cuesta una línea: va en las acciones inmediatas.

## 4. Riesgos priorizados

| # | ID | Amenaza | Riesgo |
|---|---|---|---|
| 1 | T1 | Pedido con el precio que pone el cliente | 9 |
| 2 | E1 | Service role key usada como token de webhook | 8 |
| 3 | S1 | Fuerza bruta contra staff, sin MFA ni chequeo de contraseñas filtradas | 8 |
| 4 | I1 | `factura_publica` expone la comisión y PII | 6 |
| 5 | I2 | Teléfonos del equipo en la respuesta al cliente | 6 |
| 6 | I3 | Precios "privados" legibles con la anon key | 6 |
| 7 | D1 | Spam y phishing hacia el staff vía solicitudes | 6 |
| 8 | T2 | Catálogo de demo en producción si cae Supabase | 6 |
| 9 | S2 | Contraseña inicial por email, sin cambio obligatorio | 6 |
| 10 | R1 | Eventos de seguridad auto-declarados o sin registrar | 6 |
| 11 | D2 | Worker sin alertas y backups solo en el host | 6 |
| 12 | D3 | `next` y `undici` con vulnerabilidades conocidas | 6 |
| — | E2 | `MOCK_DATA` sin resguardo (impacto crítico) | 4* |

## 5. Lo que ya está bien
- **Datos detrás de la service role:** RLS cerrada en todas las tablas sensibles, y la anon key no puede escribir en ninguna tabla.
- **Sesión verificada en la API:** las rutas usan `getUser()` y no los claims, así que una baja o un cambio de rol corta el acceso a la API en la siguiente llamada.
- **Sin IDOR:** toda ruta que recibe un id está limitada a staff o filtrada por dueño.
- **Cotizaciones a prueba de manipulación:** `aceptar_cotizacion` toma el monto de la base, bloquea la fila y valida la versión, el vencimiento y el dueño.
- **Links públicos con UUID v4:** no son enumerables.
- **XSS:** no hay `dangerouslySetInnerHTML`, y las imágenes pasan por `imagenSegura`.
- **Subida de archivos desde el panel:** valida los primeros bytes (PNG, JPEG, WEBP), rechaza SVG y limita a 5 MB.
- **Secretos:** se comparan con `timingSafeEqual`, y las contraseñas nunca se escriben en `actividad` (`limpiarDetalle`).
- **Verificado en producción el 2026-10-28:**
  - La Edge Function `admin-tickets` ya no existe.
  - La tabla `admin_auth` ya no existe.
  - No hay usuarios sin rol.
  - El bucket `mapas` es público para lectura y no tiene políticas de escritura.

## 6. Recomendaciones

### Inmediatas (cambios chicos, antes del cobro al confirmar)

Estado al 2026-10-29: los arreglos de código están en la rama `fix/seguridad-inmediatas`, **todavía sin mergear**.

| # | Recomendación | Estado |
|---|---|---|
| 1 | **T1:** en `/api/pedidos`, un ítem `pedido` sin `ticket_id` válido pasa a `consulta` con monto 0. Nunca se guarda un precio que vino del cliente. | Hecho en la rama (`bd80c82`). |
| 2 | **E2:** que `MOCK_DATA=1` no tenga efecto si `VERCEL_ENV === "production"`. | Hecho en la rama (`dd34aa4`): en producción se ignora y la app sigue con todos los controles. Fuera de Vercel no hay resguardo. |
| 3 | **E1:** usar un secreto propio para el worker (`REVALIDAR_TOKEN`) en lugar de la service role key, exigir `https://` en `TIENDA_URL` y rotar la key después del cambio. | Hecho en la rama (`589cfaa`). **Falta, a mano:** cargar `REVALIDAR_TOKEN` en Vercel y en el worker, y **rotar la service role key**. Hasta entonces se sigue aceptando la key. |
| 4 | **I1:** `factura_publica` tiene que devolver solo los campos públicos, sin `fee`. | Hecho en la rama: migración `0049` (`5589eb2`). **Falta aplicarla en producción.** |
| 5 | **I2 e I6:** devolver al cliente mensajes genéricos; el detalle va solo a los logs. | Hecho en la rama (`b513364`), en las rutas que usa el cliente. Las de staff mantienen el detalle. |
| 6 | **T2:** en producción, si falla el catálogo, mostrar un error o un catálogo vacío, nunca el de demo. Si falla `config`, fallar cerrado. | Hecho en la rama (`dd34aa4`). |
| 7 | **S1:** en Supabase Auth, activar la protección de contraseñas filtradas y confirmar que el registro público está apagado, que el cambio de contraseña pide reautenticación y que la lista de redirects es la correcta. Activar MFA para administradores. | **Pendiente.** Se configura en el panel de Supabase, no en el código. El MFA requiere desarrollo. |
| 8 | **D1:** agregar rate limit por IP y un captcha (Turnstile) en `/api/acceso/solicitar`, y agrupar los avisos al equipo. | **Parcial** (`e7f9cf9`): rate limit de 3 por IP por hora y, pasadas 10 por hora en total, solo campana, sin WhatsApp ni email. La IP se guarda como hash (migración `0050`, **falta aplicarla**). **Falta el captcha.** Lo mismo va a valer para el futuro **botón de arrepentimiento**, que también es público. |

### Corto plazo (30 días)
- **I8:** cabeceras de seguridad en `next.config.mjs`: CSP, `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy` y HSTS.
- **D3:** actualizar `next`; el arreglo de la crítica requiere salto de versión mayor, hay que evaluarlo. En el worker, actualizar `undici` y `zod`. Cambiar `vercel.json` a `npm ci`.
- **S2:**
  - Reemplazar la contraseña por email por un link de invitación o recuperación de Supabase (`generateLink`).
  - Si se mantiene la contraseña, forzar el cambio en el primer ingreso.
- **S3:** verificar el email de la solicitud con un link de confirmación antes de aprobarla.
- **R1 y R2:**
  - Registrar logins, fallos, resets y exportaciones del lado del servidor (Auth hooks o logs de Auth).
  - Poner un trigger append-only en `actividad`.
  - Guardar ids en `*_por`.
- **S4:** sacar los nombres de un campo que no edite el propio usuario, o guardar el id junto al nombre.
- **I3:** si el precio es lo que se gana al registrarse, sacar `precio_final` y `stock` de los grants de anon y servir el catálogo desde el servidor. El carrusel planeado solo necesita campos sin precio.
- **I4:** en `/op/[id]`, mostrar el alias del comprador sin el email y evaluar pedir login para ver los datos de pago.
- **E3:** limitar las rutas `actividad` y `avisos` según lo que ve el moderador.
- **R3:** pedir evidencia, como una captura o una confirmación del cliente, para aceptar una cotización "por WhatsApp".
- **T3:** en el worker, lista de hosts permitidos para las URLs del portal, rechazo de SVG y topes de precio.

### Mediano plazo (90 días)
- **D2 e I7:** backups cifrados y fuera del host, o pasar a un plan de Supabase con PITR. Alertas de salud del worker.
- **I5:** política de retención y purga de PII (Ley 25.326), y menos PII en `actividad` y `notificaciones`.
- **T4:** historial inmutable de pagos; evaluar una doble aprobación para marcar pagos.
- **Pentest** antes de que el cobro al confirmar esté en producción.

## 7. Relación con el trabajo en curso
- **Cobro al confirmar** (rama `legal/revision-cobro-al-confirmar`): sube el impacto de T1 y R3. Conviene cerrar T1 antes de activarlo.
- **Botón de arrepentimiento:** va a ser un endpoint público, así que necesita rate limit y captcha (ver D1). Además, el código de identificación que devuelve tiene que ser imposible de adivinar.
- **Login en la home** (rama `feat/login-en-home`): "recordar usuario" guarda solo el email en `localStorage`, nunca la contraseña. S1 aplica igual.
- **Carrusel** (rama `docs/carrusel-eventos-home`): la subida de fotos tiene que reusar la validación por bytes de `tickets/mapa` y rechazar SVG. Las fotos van a un bucket público sin políticas de escritura (igual que `mapas`).

## 8. No verificado (requiere acceso que no hubo)
- Configuración de Supabase Auth: registro público, rate limits, lista de redirects y cambio de contraseña seguro. Solo se confirmó que la protección de contraseñas filtradas está **apagada**.
- Si `NEXT_PUBLIC_SITE_URL` está definida y `MOCK_DATA` está ausente en Vercel producción.
- Si el repositorio es o fue público (afecta a I10).
- Dónde corre el worker y quién tiene acceso a ese host.
