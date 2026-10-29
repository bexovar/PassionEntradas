// En qué entorno corre la app. Puro (lee un objeto env), así se puede testear
// y lo puede usar también el middleware (edge).

type Env = Record<string, string | undefined>;

// Producción = el deploy de producción de Vercel. Los previews y el build de
// CI (que corre con MOCK_DATA=1) no cuentan.
export function esProduccion(env: Env = process.env): boolean {
  return env.VERCEL_ENV === "production";
}

// Modo demo (MOCK_DATA=1): datos en memoria y SIN autenticación — el
// middleware y las rutas abren todo. En producción eso sería dejar el panel
// y la API sin login, así que ahí se ignora: si alguien lo activa por error,
// la app sigue funcionando con Supabase y con todos los controles.
export function modoDemo(env: Env = process.env): boolean {
  if (env.MOCK_DATA !== "1") return false;
  if (esProduccion(env)) {
    console.error("[entorno] MOCK_DATA=1 en producción: se ignora, el modo demo no abre la app.");
    return false;
  }
  return true;
}
