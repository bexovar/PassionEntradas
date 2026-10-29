import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getRol } from "@/lib/auth";
import { decidirRuteo } from "@/lib/ruteo";
import { sesionCaida } from "@/lib/sesion";
import { usuarioDeClaims, type UsuarioDeClaims } from "@/lib/claims";
import { modoDemo } from "@/lib/entorno";

// Refresca la sesión de Supabase Auth y RUTEA los módulos:
// - /admin: solo administrador (los moderadores van a /moderador), salvo
//   /admin/cuenta (cambio de contraseña propio): todo el staff.
// - /moderador: cualquier usuario del staff.
// - /entradas y /buscar (la tienda): staff o CLIENTE aprobado. Anónimo -> al
//   login de cliente (/ingresar). La tienda dejó de ser pública.
// - Sesión SIN rol: no es de nadie, se corta y afuera.
// - La landing (/) es pública, pero al staff lo manda a su panel.
//
// La REGLA en sí (qué rol va a dónde) vive en lib/ruteo.ts, pura y con tests:
// es lo que sostiene los permisos del sitio, y acá no se puede verificar — el
// modo demo saltea la autenticación entera. Este archivo solo la aplica.
// /op/[id] y la factura pública quedan fuera del matcher.
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // `response` es donde Supabase escribe las cookies: la sesión refrescada, o
  // el borrado de la cookie cuando la sesión ya no existe. Se declara ANTES de
  // cualquier redirect porque redirectTo las tiene que arrastrar.
  let response = NextResponse.next({ request });

  function redirectTo(pathname: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const redirect = NextResponse.redirect(url);
    // Un NextResponse.redirect nuevo NO hereda nada de `response`. Si se
    // devuelve pelado, el Set-Cookie que borra la sesión muerta nunca llega al
    // navegador: la cookie vieja vuelve en el request siguiente, Supabase
    // intenta refrescarla de nuevo y el 400 refresh_token_not_found se repite
    // para siempre. Por eso las cookies viajan con la redirección.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  // Modo demo sin Supabase: todo abierto; los logins mandan a su módulo.
  // Nunca en producción (lib/entorno).
  if (modoDemo()) {
    if (path === "/admin/login") return redirectTo("/admin");
    if (path === "/ingresar") return redirectTo("/entradas");
    return NextResponse.next();
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: { name: string; value: string; options: CookieOptions }[]
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Quién es: las claims del token, verificadas LOCALMENTE con la clave
  // pública del proyecto (getClaims, ES256). Antes era getUser(), que le
  // pregunta al servidor de Auth: el middleware corre en el borde de Vercel
  // más cercano a quien navega (San Pablo), lejos de Supabase (Oregon), y ese
  // viaje en CADA cambio de página tardaba 0,3 s la mediana y más de 15 s en
  // el 5 % peor. Con más de ~25 s el refresco de fondo del panel fallaba y
  // Next recargaba la página entera, borrando lo que se estaba cargando.
  // Ver lib/claims.ts. Cada página y API sigue validando con getUser() (desde
  // pdx1, al lado de Supabase) antes de mostrar o tocar datos.
  // getClaims solo devuelve como {error} los errores de Auth; una cookie
  // rota (JSON o JWT mal formado) puede tirar otra cosa. Eso no tiene que
  // tumbar el middleware: se trata como token no verificable y decide Auth.
  let user: UsuarioDeClaims | User | null = null;
  let error: Parameters<typeof sesionCaida>[0] | Error = null;
  try {
    const claims = await supabase.auth.getClaims();
    user = usuarioDeClaims(claims.data?.claims);
    error = claims.error;
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }
  // Contra Auth cuando las claims no alcanzan: un token que no se pudo
  // verificar por algo que no es "no hay sesión" ni la red (firma inválida,
  // clave desconocida) decide el servidor, como antes.
  let verificado = false;
  if (
    !user &&
    error &&
    error.name !== "AuthSessionMissingError" &&
    error.name !== "AuthRetryableFetchError" &&
    !sesionCaida(error)
  ) {
    const r = await supabase.auth.getUser();
    user = r.data.user;
    error = r.error;
    verificado = true;
  }

  // La cookie apunta a una sesión que Auth ya no tiene (usuario borrado,
  // sesión revocada, clave rotada). Hay que sacarle la cookie al navegador acá
  // mismo: si sigue mandándola, cada request vuelve a intentar el refresh y
  // vuelve a fallar. signOut local borra la cookie sin pedirle nada al servidor
  // de Auth, que para esta sesión ya no tiene nada que decir.
  if (sesionCaida(error)) {
    await supabase.auth.signOut({ scope: "local" });
    return redirectTo("/ingresar");
  }

  let decision = decidirRuteo(path, user ? getRol(user as User) : null, !!user);

  // Las claims son las del momento en que se emitió el token (hasta 1 h): un
  // cambio de rol o un "desactivar" de Equipo todavía no está ahí. Para dejar
  // pasar alcanza (la página revalida); para SACAR a alguien de donde está
  // (redirect, cerrar sesión) se confirma con Auth primero. Es raro: el staff
  // entrando a la landing o a un login, un rol que cambió.
  if (user && !verificado && decision.accion !== "seguir") {
    const r = await supabase.auth.getUser();
    if (sesionCaida(r.error)) {
      await supabase.auth.signOut({ scope: "local" });
      return redirectTo("/ingresar");
    }
    if (r.error?.name === "AuthRetryableFetchError") {
      // Auth no contesta (caído, 5xx, red). Sin confirmar no se saca a nadie
      // de donde está: se deja pasar, como antes de las claims. Con el
      // redirect de las claims se armaba un loop en una caída de Auth: la
      // página no podía validar y mandaba a /ingresar, y desde /ingresar las
      // claims (admin) mandaban de vuelta a /admin, para siempre.
      decision = { accion: "seguir" };
    } else {
      user = r.data.user;
      decision = decidirRuteo(path, user ? getRol(user as User) : null, !!user);
    }
  }

  if (decision.accion === "cerrar-sesion") {
    // Sesión que no es de nadie: se cierra para que el login no la recicle en
    // un loop de redirecciones.
    await supabase.auth.signOut();
    return redirectTo(decision.a);
  }
  if (decision.accion === "redirigir") {
    return redirectTo(decision.a);
  }

  return response;
}

export const config = {
  matcher: [
    // La raíz entra al matcher solo para mandar al staff a su panel; el
    // anónimo y el cliente siguen viendo la landing estática.
    "/",
    "/admin/:path*",
    "/moderador/:path*",
    "/entradas/:path*",
    "/cuenta/:path*",
    "/mis-pedidos/:path*",
    "/buscar",
    "/mapa",
    "/ingresar",
  ],
};
