# Carrusel de eventos con fotos en la home

> Estado: **implementado según TKT-12** (redefinido el 31/10). Falta aplicar `0051_carrusel_home.sql` en Supabase y cargar las fotos: sin tarjetas con foto, la home no muestra el carrusel. El bloqueante del ticket sigue abierto: **de dónde salen las fotos** (ver [preguntas-cliente.md](preguntas-cliente.md)).

## Qué es
Después de "Cómo funciona" y antes del footer, un carrusel de 6 a 8 eventos con foto. Es el cierre del funnel de la home: el agente que llega en frío ve qué se vende, y el querer ver el precio lo lleva a pedir acceso.

## Decisiones (del ticket)
- **Curado a mano, no sale del inventario.** El admin arma las tarjetas desde `/admin/entradas` → "Carrusel de eventos". Así no se cuelan nombres del proveedor en inglés ni con formatos raros. *(La primera versión de esta rama sacaba los eventos del catálogo y el admin solo subía fotos; se reemplazó.)*
- **Cantidad:** hasta 8 (`MAX_CARRUSEL`). El panel avisa si hay menos de 6 listas para mostrarse.
- **Cada tarjeta:** foto, nombre del evento, competencia o categoría, **mes y año**.
- **Nunca:** precio, stock, disponibilidad ni cantidad de ubicaciones. La tabla no tiene dónde guardarlos y `lib/carrusel.test.ts` lo fija.
- **Sin foto no hay tarjeta.** Tampoco la de un mes que ya pasó (la del mes en curso sigue).
- **Encuadre fijo 4:3** para todas: el panel recorta cada foto a 1200×900 antes de subirla (`components/admin/EncuadreFoto`, `lib/encuadre`), y la home usa `object-fit: cover` como garantía.
- **Navegación:** flechas en escritorio; en el celular se desliza con el dedo. Sin autoplay; respeta `prefers-reduced-motion`.
- **Al tocar una tarjeta** se abre el modal de solicitud de acceso, el mismo de TKT-7. Con sesión, la tarjeta lleva a `/entradas`.
- **Editable sin desplegar:** cada cambio del panel llama a `refrescarTienda()`; además la home se regenera cada 5 minutos.

## Piezas
- **Migración** `supabase/migrations/0051_carrusel_home.sql`: tabla `carrusel_home` (`nombre`, `categoria`, `mes` = día 1 del mes, `imagen_url` nullable, `orden`, `actualizada_por`), lectura anon de las columnas que muestra la home, escritura solo service role, bucket público `carrusel`. Reemplaza a la versión anterior de la rama (`fotos_carrusel`), que nunca llegó a main: si se aplicó en algún entorno, la migración la borra.
- **Dominio** `lib/carrusel.ts` (con test): `tarjetasVisibles` (orden, con foto, sin vencidas, hasta 8), `estadoTarjeta` (lo que ve el panel), `validarTarjeta`, `reordenar`, `fotoCarruselValida` (solo nuestro bucket), `mesLegible`.
- **Home:** `app/(tienda)/page.tsx` lee `fetchCarrusel()` (`lib/supabase/public.ts`, caché con el tag del catálogo) y lo pasa a `<Landing>`; `components/tienda/CarruselEventos.tsx` lo dibuja.
- **API** `app/api/carrusel/route.ts`, solo admin: `GET`, `POST` (tarjeta nueva, con o sin foto), `PUT` (cambiar la foto; la anterior se borra del bucket), `PATCH` (mover o editar textos), `DELETE`. Registra actividad (`carrusel.*`).
- **Panel** `components/admin/CarruselHomePanel.tsx`: lista en orden con miniatura, estado (*se muestra* / *sin foto* / *ya pasó*), subir/bajar, editar, cambiar foto y sacar; formulario para sumar un evento.
- **Demo:** `lib/mock-db.ts` trae 7 tarjetas de muestra (una sin foto, para ver que no aparece) con las imágenes de `public/carrusel-demo/`.

## Verificación
1. `npx tsc --noEmit` y `npm test`.
2. Con `MOCK_DATA=1 npm run dev`: en `/` se ven 6 tarjetas (la del show no tiene foto); tocar una abre el modal de solicitud; en `/admin/entradas` sumar, editar, mover, cambiar foto y sacar, y ver el cambio en `/` sin reiniciar.
3. Escritorio y celular: flechas / deslizar, nombres largos con salto de línea (sin "…"), fotos todas iguales.
4. En el HTML de `/`: nada de `precio`, `stock` ni "disponib".
5. En una rama de Supabase: aplicar la migración, subir una foto real al bucket `carrusel` y comprobar que anon puede leer `carrusel_home` pero no `actualizada_por`.
