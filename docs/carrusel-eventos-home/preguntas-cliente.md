# Carrusel de eventos: preguntas para el cliente

Para dejar el carrusel de eventos como lo imaginan, necesitamos confirmar algunos puntos.

## Qué eventos se muestran

1. ¿Mostramos todos los eventos disponibles o solo algunos destacados? Si son todos, ¿hay un máximo? Proponemos 12.
2. ¿En qué orden? ¿Por fecha (lo más cercano primero) o prefieren elegir ustedes cuáles van adelante?
3. Un torneo como el Mundial tiene decenas de partidos. ¿Mostramos cada partido como una tarjeta, o una sola tarjeta por torneo ("Mundial 2026 – 104 partidos")?
4. ¿Mostramos eventos que hoy no tienen entradas pero se pueden pedir a pedido, o solo los que tienen stock?
5. ¿Hasta cuándo se muestra un evento? ¿Hasta el día del evento, o lo sacamos unos días antes porque ya no se puede vender?

## Fotos

6. ¿Quién va a cargar las fotos y con qué frecuencia? ¿Hay una persona responsable?
7. ¿Tienen fotos propias o con derechos de uso? Las imágenes con marcas oficiales (FIFA, UEFA, Fórmula 1) tienen restricciones.
8. ¿Prefieren fotos del lugar (estadios, circuitos), del ambiente (público, jugadores) o piezas gráficas con el logo del evento?
9. Si un evento no tiene foto, ¿lo ocultamos, o lo mostramos con una imagen genérica de la marca?

## Qué dice cada tarjeta

10. Además del nombre, la fecha y la ciudad, ¿quieren mostrar el estadio, el tipo de evento (fútbol, F1, tenis) o alguna etiqueta como "Últimos lugares" o "Nuevo"?
11. Nombres y ciudades: el catálogo los trae del proveedor, a veces en inglés o con formatos raros. ¿Los mostramos así, o quieren poder corregirlos para la home?
12. ¿El carrusel también se ve en inglés cuando el visitante cambia el idioma?

## Comportamiento

13. ¿Hacer click en una tarjeta debería hacer algo? Por ejemplo, abrir el formulario de acceso con ese evento ya cargado en "¿Buscás algo en particular?".
14. ¿Avanza solo, o solo cuando el usuario lo mueve? Recomendamos que no avance solo.
15. ¿Qué dice la tarjeta final que invita a registrarse? ¿Podemos mencionar que los precios se ven al ingresar, o preferimos no hablar de precios?

## Diseño

16. Cuando dicen "estética de lego", ¿se refieren a los bloques con bordes y sombras marcadas que ya tiene el sitio, o a algo más literal (piezas, encastres)? Si tienen una referencia visual, nos ayuda mucho.
17. ¿El título de la sección? Proponemos "Eventos disponibles".

## Usuarios con sesión

18. Un agente que ya ingresó y vuelve a la home, ¿ve el mismo carrusel? ¿O, como ya tiene acceso, lo mandamos directo a la tienda con precios?

---

## Nota interna (no enviar)

Las que más cambian el trabajo:

- **3 (una tarjeta por torneo):** cambia cómo se agrupan los eventos.
- **11 (corregir nombres):** suma un campo editable por evento en el panel.
- **13 (click que precarga el formulario):** necesita la rama del login en la home (`feat/login-en-home`), donde el formulario es un modal.
- **16 (lego literal):** si es eso, es un diseño nuevo y no la estética actual.

Las demás son definiciones de contenido que se resuelven en el panel o en los textos.
