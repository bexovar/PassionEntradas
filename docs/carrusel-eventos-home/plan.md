# Carrusel de eventos con fotos en la home

> Estado: **implementado** (carrusel, panel de fotos y encuadre), con las decisiones de este plan. Las respuestas de [preguntas-cliente.md](preguntas-cliente.md) siguen pendientes: varias pueden cambiar el alcance. Falta aplicar `0051_fotos_carrusel.sql` en Supabase (punto 4 de la verificación); sin ella la home no muestra el carrusel.

## Contexto
Después de "Cómo funciona", la home termina en el footer. Los eventos solo se nombran en la bajada del hero. El agente que llega en frío (por un comentario o una tarjeta, no por referido) necesita ver el producto. Se agrega un carrusel de eventos disponibles, con fotos y **sin precio**: es el cierre del funnel de la home, y querer ver el precio es lo que lleva a pedir acceso.

**Decisión tomada:** los eventos salen **automáticamente del catálogo real**. El admin solo sube fotos. Un evento sin foto no aparece en el carrusel.

## Cómo funciona hoy (lo relevante)
- **No hay entidad "evento".** `tickets` tiene una fila por sector (`0003_tickets_catalogo.sql`). Los eventos se arman en JS con `buildEvents()` ([lib/tickets.ts:332](lib/tickets.ts#L332)), que agrupa por `competicion + evento` y devuelve `EventoAgrupado`.
- **No hay foto de evento.** La única imagen es el mapa de sectores (`imagen_url`), que no sirve para esto.
- **El catálogo público** se lee con `fetchTickets()` ([lib/supabase/public.ts:21](lib/supabase/public.ts#L21)). Tiene caché de 60 s con el tag `catalogo` y cae al catálogo demo si falla. **Ese RPC devuelve precios**, así que el filtro de precio tiene que pasar en el servidor.
- **La home es estática** (`force-static` en [app/(tienda)/page.tsx:15](app/(tienda)/page.tsx#L15)) y no pide datos. `refrescarTienda()` ([lib/refrescar-tienda.ts](lib/refrescar-tienda.ts)) ya revalida todo el grupo `(tienda)`, que incluye `/`, cada vez que cambia el catálogo.
- **Ya hay subida de imágenes:** [app/api/tickets/mapa/route.ts](app/api/tickets/mapa/route.ts) acepta solo admin, máximo 5 MB, y valida PNG/JPG/WEBP por los primeros bytes. En demo devuelve una data URL. El URL se valida con `mapaPropioValido` ([lib/tickets.ts:301](lib/tickets.ts#L301)).
- **Patrón de panel editable:** [lib/textos.ts](lib/textos.ts), [app/api/textos-pago/route.ts](app/api/textos-pago/route.ts) (`soloAdmin`, modo demo, actividad) y [components/admin/TextosPagoPanel.tsx](components/admin/TextosPagoPanel.tsx), montado en [app/admin/entradas/page.tsx:114](app/admin/entradas/page.tsx#L114).
- **Estética:** existe la tarjeta ticket (`.ticket` y `.ticket-stub` con perforación punteada y muescas en [tienda.css:174](app/(tienda)/tienda.css#L174) y [:430](app/(tienda)/tienda.css#L430)), además de bordes de tinta y sombras duras de 6px. **No existe ningún estilo "lego" ni ningún carrusel.**

## Diseño

### 1. Fotos: tabla, bucket y validación
- Migración `supabase/migrations/00XX_fotos_carrusel.sql`:
  - Tabla `fotos_carrusel` con `id uuid pk`, `competicion text not null`, `evento text` (null significa foto de toda la competición), `imagen_url text not null`, `orden int not null default 0`, `created_at`, `subida_por text`.
  - **Varias fotos por competición o evento:** no hay restricción de unicidad. Índice en `(competicion, evento, orden)` y un tope de 10 fotos por competición o evento, controlado en la API.
  - RLS con lectura para anon (son URLs públicas, como el catálogo) y escritura solo por service role.
  - **Bucket público `carrusel`**, separado de `mapas`.
- **Fotos por evento o por competición:** si un partido no tiene fotos propias, usa las de su competición. Unas pocas fotos de "Mundial 2026" cubren todos los partidos que trae el portal, así el admin no tiene que subir una por partido.
- **Las fotos se reparten entre tarjetas:** cada tarjeta muestra una sola foto.
  - Los partidos de una competición, ordenados por fecha, van alternando las fotos de esa competición: el 1.º usa la foto 1, el 2.º la foto 2, y al terminarse vuelve a empezar. Así el carrusel no repite la misma imagen seguida.
  - Un evento con fotos propias muestra la primera según `orden`. El admin elige cuál reordenando; las demás quedan de repuesto.
  - El reparto es determinístico (sale del orden por fecha), así que no cambia en cada visita.

### 2. Dominio: `lib/carrusel.ts` (nuevo, con test)
- `eventosCarrusel(eventos, fotos, max = 12)`:
  - Recibe los `EventoAgrupado` de `buildEvents()`, con el mismo criterio de "disponible" que ya usa la tienda.
  - Deja solo los que tienen alguna foto (propia o de su competición), ordena por fecha (el más cercano primero) y corta en `max`.
  - Asigna la foto de cada tarjeta con el reparto descrito arriba: la primera propia o, si no tiene, la que le toca de la competición.
  - **Devuelve solo** `{ clave, evento, competicion, fecha, lugar, imagen }`. Ningún campo de precio sale de esta función, así que nada de precio llega al HTML ni al payload del cliente.
- `fotoCarruselValida(url, demo)`: igual que `mapaPropioValido`, pero para el bucket `carrusel`.

### 3. Datos en la home
- [lib/supabase/public.ts](lib/supabase/public.ts): agregar `fetchFotosCarrusel()` con `unstable_cache` y el tag `catalogo`, más una rama demo.
- [app/(tienda)/page.tsx](app/(tienda)/page.tsx) pasa a ser componente async del servidor:
  - Llama a `fetchTickets()`, `buildEvents()`, `fetchFotosCarrusel()` y `eventosCarrusel()`, y le pasa la lista a `<Landing carrusel={...} />`.
  - Cambia `force-static` por `revalidate = 300`. Sigue siendo estática para el visitante y se regenera cuando `refrescarTienda()` invalida el tag.

### 4. El carrusel: `components/tienda/CarruselEventos.tsx` (nuevo)
- **Ubicación:** sección después de "Cómo funciona" en [components/tienda/Landing.tsx](components/tienda/Landing.tsx), con encabezado `section-h` (eyebrow y título). Si la lista viene vacía, la sección no se muestra.
- **Desplazamiento:** pista horizontal con CSS `scroll-snap`. En celular se desliza con el dedo; en escritorio hay flechas anterior y siguiente. **Sin autoplay**, y respeta `prefers-reduced-motion`.
- **Tarjeta estilo ticket:**
  - Arriba la foto, con borde de tinta y sombra dura como el resto del sitio.
  - Abajo un talón con perforación y muescas (reusa `.ticket-stub`): competición, nombre del evento, ciudad y el bloque de fecha (`.cal`).
- **Sin recortes en celular:**
  - El recuadro de la foto tiene **proporción fija 4:3** (`aspect-ratio: 4 / 3`) en todos los anchos. La tarjeta cambia de tamaño pero no de forma, así que se ve igual en escritorio y en celular.
  - Las fotos ya llegan encuadradas a 4:3 (ver el punto 5), así que llenan el recuadro sin que el CSS corte nada.
  - **Respaldo** solo para una foto fuera de 4:3: se muestra entera (`object-fit: contain`) y el sobrante se rellena con la misma imagen desenfocada.
  - Los nombres hacen salto de línea, sin `ellipsis` ni `line-clamp`.
  - Cada tarjeta ocupa ~80% del ancho, para que se asome la siguiente.
- **Cierre:** al final de la pista, una tarjeta con "Solicitar acceso" que lleva al formulario.
- **Textos:** en [lib/tienda-i18n.ts](lib/tienda-i18n.ts), español e inglés.
- **Estilos:** `.lp-carrusel*` en [app/(tienda)/tienda.css](app/(tienda)/tienda.css).

### 5. Panel de admin: "Fotos del carrusel"
- **API** `app/api/carrusel/fotos/route.ts`, copiando el patrón de `tickets/mapa` y `textos-pago`:
  - `GET` lista las fotos.
  - `POST` agrega una foto (multipart, 5 MB, validación por bytes) a una competición o un evento, hasta el tope de 10.
  - `DELETE` saca una foto.
  - Solo admin. Registra `actividad` y llama a `refrescarTienda()`.
- **Panel** `components/admin/FotosCarruselPanel.tsx`, montado en [app/admin/entradas/page.tsx](app/admin/entradas/page.tsx) junto a `TextosPagoPanel`. El menú tiene 4 ítems a propósito y no se agrega un quinto.
  - Lista las competiciones y los eventos disponibles del catálogo, cada uno con su estado: *fotos propias*, *usa las de la competición* o *sin foto, no aparece*.
  - Cada competición y evento muestra una tira de miniaturas, con botones para agregar fotos (de a una o varias), sacar y reordenar (subir y bajar). La primera es la principal.
  - **Encuadre al subir:** al elegir una foto se abre un editor con un marco fijo 4:3. El admin arrastra y hace zoom con un slider para elegir qué parte se ve.
    - El recorte se hace en el navegador (canvas) y se sube ya exportado a **1200×900 WebP**, así todas las fotos quedan iguales y livianas sin agregar nada al servidor.
    - Componente propio `components/admin/EncuadreFoto.tsx` (con pointer events y canvas, sin librerías nuevas). La lógica del encuadre (zoom mínimo, límites del arrastre, rectángulo de recorte) va en `lib/encuadre.ts`, con test.
    - **Validación:** se rechaza una foto de menos de 800 px de ancho o de alto, con un mensaje claro ("La foto es muy chica, se vería pixelada"). La API además revalida tipo y peso.
    - Si se suben varias a la vez, se encuadran de a una.
  - Vista previa de la tarjeta tal como se va a ver.
  - Sección aparte **"Eventos que ya pasaron"**: lista las fotos de eventos que salieron del catálogo, con un botón para borrarlas. Las fotos de competición no vencen.
  - `PATCH` en la API para reordenar.
- **Modo demo:** fotos en [lib/mock-db.ts](lib/mock-db.ts) y subida como data URL, igual que `tickets/mapa`, para que `MOCK_DATA=1` y el build de CI sigan andando.

### 6. Qué pasa cuando un evento vence
No hace falta lógica nueva: el carrusel sale del mismo catálogo que la tienda, que ya filtra los eventos pasados. El RPC `catalogo_tienda` pide `fecha >= hoy` y `fetchTickets()` aplica `sinEventosPasados` ([lib/supabase/public.ts:24-43](lib/supabase/public.ts#L24-L43)).
- **Evento que pasa:** se muestra hasta el día del evento inclusive (hora Argentina) y sale al día siguiente. Con `revalidate = 300` puede quedar a lo sumo unos minutos de más.
- **Evento sin stock o no disponible:** sale igual que de la tienda.
- **Evento sin fecha:** queda mientras siga en el catálogo, como en la tienda.
- **Sus fotos** quedan en la tabla pero no se muestran, y el panel las lista en "Eventos que ya pasaron" para borrarlas.

## A tener en cuenta
- **"Lego":** no hay nada con ese estilo en el sitio. Tomo "lego y ticket" como el lenguaje de bloques que ya tiene la tienda (bordes de tinta, sombras duras, bloques cobalto) más el talón de ticket. Si "lego" significa otra cosa, conviene confirmarlo antes de diseñar.
- **Derechos de las fotos:** las imágenes con marcas oficiales (FIFA, UEFA, F1) tienen restricciones de uso. Las fotos las elige y sube el cliente.
- **Ramas abiertas:** sale de `main` como rama propia (`feat/carrusel-eventos-home`). Toca `Landing.tsx`, `tienda-i18n.ts` y `tienda.css`, igual que las otras tres ramas de la landing, así que al mergear habrá conflictos chicos. En la rama del login, el "Solicitar acceso" del cierre tiene que abrir el modal.
- **Esfuerzo estimado:** ~3,5 días (migración y panel ~1,5; encuadre ~0,5; carrusel y estilos ~1; tests y QA ~0,5).

## Sketch

**Home en escritorio**: la sección va después de "Cómo funciona"; se ven ~3,5 tarjetas.
```
 EN AGENDA
 EVENTOS DISPONIBLES                                         [ ← ] [ → ]
 ───────────────────────────────────────────────────────────────────────
 ┌─────────────────────┐▌ ┌─────────────────────┐▌ ┌─────────────────────┐▌ ┌──────
 │                     │▌ │                     │▌ │                     │▌ │
 │       [ FOTO ]      │▌ │       [ FOTO ]      │▌ │       [ FOTO ]      │▌ │  [ F
 │   completa, sin     │▌ │                     │▌ │                     │▌ │
 │   recortar          │▌ │                     │▌ │                     │▌ │
 ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤▌ ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤▌ ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤▌ ├ ─ ─ ─
 (  ┌────┐ WORLD CUP 26 )▌ (  ┌────┐ EURO 2028   )▌ (  ┌────┐ FÓRMULA 1   )▌ (  ┌───
 │  │ 11 │ México vs    │▌ │  │ 14 │ España vs   │▌ │  │ 05 │ GP de Monza │▌ │  │
 │  │ JUN│ Sudáfrica    │▌ │  │ JUN│ Italia      │▌ │  │ SEP│             │▌ │  │
 │  └────┘ Estadio      │▌ │  └────┘ Wembley,    │▌ │  └────┘ Monza (ITA) │▌ │  └───
 │         Azteca (MEX) │▌ │         Londres     │▌ │                     │▌ │
 └─────────────────────┘▌ └─────────────────────┘▌ └─────────────────────┘▌ └──────
  ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   (sombra dura)
```
- **Arriba:** la foto. Si no tiene la proporción del marco, el espacio sobrante se rellena con la misma imagen desenfocada.
- **Abajo:** el talón de ticket, con la línea perforada (`─ ─ ─`) y las muescas a los lados (`(  )`). Lleva el bloque de fecha, la competición en cobalto y el nombre completo del evento, con salto de línea (nunca "…").
- **Sin precio ni stock.**

**Última tarjeta, el cierre del funnel:**
```
 ┌─────────────────────┐▌
 │  ¿Querés ver        │▌
 │  disponibilidad     │▌
 │  y condiciones?     │▌
 │                     │▌
 │ [ SOLICITAR ACCESO ]│▌
 └─────────────────────┘▌
```

**Celular (390 px)**: una tarjeta al ~80% y se asoma la siguiente. Se desliza con el dedo, sin flechas.
```
 ┌──────────────────────────────┐
 │ EN AGENDA                    │
 │ EVENTOS DISPONIBLES          │
 │ ┌───────────────────────┐▌ ┌─│
 │ │                       │▌ │ │
 │ │       [ FOTO ]        │▌ │ │
 │ │                       │▌ │ │
 │ ├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┤▌ ├ │
 │ (  ┌────┐ WORLD CUP 26  )▌ ( │
 │ │  │ 11 │ México vs     │▌ │ │
 │ │  │ JUN│ Sudáfrica     │▌ │ │
 │ │  └────┘ Estadio Azteca│▌ │ │
 │ │         (MEX)         │▌ │ │
 │ └───────────────────────┘▌ └─│
 │        ● ○ ○ ○ ○             │
 └──────────────────────────────┘
```

**Panel de admin** (`/admin/entradas` → "Fotos del carrusel"):
```
 FOTOS DEL CARRUSEL DE LA HOME
 Un evento sin fotos (propias ni de su competición) no aparece en la home.

 WORLD CUP 2026 · competición                      3 fotos
 [▣ 1][▣ 2][▣ 3]  [+ Agregar]      (cada miniatura: ↑ ↓ ✕)
   ├ México vs Sudáfrica     usa las de la competición  [+ Fotos propias]
   ├ Argentina vs Argelia    2 fotos propias  [▣][▣]    [+]
   └ Brasil vs Marruecos     usa las de la competición  [+ Fotos propias]

 FÓRMULA 1 · competición                           sin fotos
 [+ Agregar]
   └ GP de Monza             ⚠ sin foto, no aparece     [+ Fotos propias]

 ▸ EVENTOS QUE YA PASARON (2)                      [Borrar fotos]
```

## Verificación
1. **Tests** en `lib/carrusel.test.ts`:
   - Prioridad de la foto: la primera propia del evento, si no una de su competición. Los eventos sin ninguna foto quedan afuera.
   - Reparto: 3 fotos de competición y 5 partidos dan las fotos 1, 2, 3, 1, 2 en orden de fecha, y el resultado es el mismo en cada llamada.
   - Un evento ya pasado no aparece aunque tenga fotos.
   - Orden por fecha y corte en `max`.
   - **Ningún objeto devuelto tiene campos de precio.**
   - `fotoCarruselValida` rechaza URLs fuera del bucket.
   - En `lib/encuadre.test.ts`: el zoom mínimo siempre cubre el marco 4:3, el arrastre no deja huecos en los bordes, el recorte de una foto vertical y de una panorámica da el rectángulo esperado, y se rechazan fotos de menos de 800 px.
2. `npx tsc --noEmit`, `npm test` y `MOCK_DATA=1 npm run build`.
3. **En el navegador** con `MOCK_DATA=1 npm run dev`:
   - Subir varias fotos a una competición y una a un evento puntual desde `/admin/entradas`, reordenarlas y ver en `/`, después de que se refresque, que los partidos alternan las fotos.
   - Encuadrar una foto vertical y una panorámica: la tarjeta tiene que mostrar exactamente lo que se eligió en el editor. Probar también que una foto de 600 px se rechaza.
   - Cambiar la fecha de un evento manual a ayer y comprobar que sale del carrusel y que su foto aparece en "Eventos que ya pasaron".
   - Revisar en escritorio y a 390 px: deslizar, que las imágenes no se recorten y que los nombres largos no se corten.
   - Buscar en el HTML y en el payload de `/` que no aparezcan `precio`, `minPrice` ni importes.
4. **En una rama de Supabase:** aplicar la migración, subir una foto real al bucket `carrusel` y comprobar que anon puede leer `fotos_carrusel`.
