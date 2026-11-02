// A dónde va cada rol en cada ruta.
//
// Esta decisión vive en el middleware y es la que sostiene los permisos del
// sitio: que un cliente no entre al panel, que una sesión sin rol quede afuera,
// que el staff no aterrice en la página de captación. El middleware no se puede
// testear en el modo demo (ahí se saltea la autenticación entera), así que la
// regla vive acá, pura y con tests, y el middleware solo la aplica.

import type { Rol } from "@/lib/auth";

export type Zona = "landing" | "login" | "tienda" | "panel" | "otra";

export function zonaDe(path: string): Zona {
  if (path === "/") return "landing";
  if (path === "/ingresar" || path === "/admin/login") return "login";
  if (
    path === "/buscar" ||
    path === "/mapa" ||
    path.startsWith("/entradas") ||
    path.startsWith("/cuenta") ||
    path.startsWith("/mis-pedidos")
  ) {
    return "tienda";
  }
  if (path.startsWith("/admin") || path.startsWith("/moderador")) return "panel";
  return "otra";
}

/** Dónde arranca cada rol cuando no pidió una página en particular. */
export function inicioDe(rol: Rol | null): string {
  return rol === "administrador" ? "/admin" : rol === "moderador" ? "/moderador" : "/entradas";
}

// Páginas de /admin que también abre un moderador.
const RUTAS_MODERADOR = new Set(["/admin/cuenta", "/admin/clientes"]);

export type Decision =
  | { accion: "seguir" }
  | { accion: "redirigir"; a: string }
  /** Sesión que no es de nadie: se cierra y afuera. */
  | { accion: "cerrar-sesion"; a: string };

export function decidirRuteo(
  path: string,
  rol: Rol | null,
  hayUsuario: boolean
): Decision {
  const zona = zonaDe(path);

  // Sin sesión: la tienda y el panel piden login. La landing queda abierta,
  // que es por donde se pide el acceso.
  if (!hayUsuario) {
    if (zona === "tienda" || zona === "panel") return { accion: "redirigir", a: "/ingresar" };
    return { accion: "seguir" };
  }

  // Sesión sin rol (cuenta creada por fuera de la app): no entra a ningún
  // lado. Se cierra para que el login no la recicle en loop.
  if (rol == null) {
    if (zona === "login") return { accion: "seguir" };
    return { accion: "cerrar-sesion", a: "/ingresar" };
  }

  // Ya logueado entrando a cualquier login -> a su lugar.
  if (zona === "login") return { accion: "redirigir", a: inicioDe(rol) };

  // La landing la ve cualquiera con rol. El staff también: el admin la abre
  // desde el panel para copiar el link de solicitud y mandárselo a alguien
  // (antes lo mandaba a su panel y tenía que editar la URL a mano).
  if (zona === "landing") return { accion: "seguir" };

  // Cliente: solo la tienda.
  if (rol === "cliente") {
    return zona === "panel" ? { accion: "redirigir", a: "/entradas" } : { accion: "seguir" };
  }

  // Moderador: su módulo, no el de administración. Las excepciones: su propia
  // cuenta (cambiar la contraseña) y la lista de Clientes, que también ve.
  if (rol === "moderador" && path.startsWith("/admin") && !RUTAS_MODERADOR.has(path)) {
    return { accion: "redirigir", a: "/moderador" };
  }

  return { accion: "seguir" };
}

// --- volver al link profundo después del login ------------------------------
// El que abre /buscar?q=… sin sesión pasa por /ingresar y, al entrar, tiene
// que volver a ese link, no a /entradas. El link viaja en ?next=.

export const PARAM_RETORNO = "next";

/** /ingresar con el link pedido para volver después del login. */
export function loginConRetorno(pedido: string): string {
  return `/ingresar?${PARAM_RETORNO}=${encodeURIComponent(pedido)}`;
}

/**
 * El ?next= solo si es seguro seguirlo: una ruta propia (nada de
 * "//otro.sitio" ni "https://…", que serían un redirect abierto) y una a la
 * que ese rol puede entrar. Si no, null y va a su inicio.
 */
export function retornoSeguro(next: string | null | undefined, rol: Rol | null): string | null {
  if (!next || next.length > 2000) return null;
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  let url: URL;
  try {
    url = new URL(next, "http://x");
  } catch {
    return null;
  }
  if (url.origin !== "http://x") return null;
  // Volver a un login no tiene sentido (y sería un loop).
  if (zonaDe(url.pathname) === "login") return null;
  if (decidirRuteo(url.pathname, rol, true).accion !== "seguir") return null;
  return url.pathname + url.search + url.hash;
}

/** A dónde va alguien que acaba de ingresar. */
export function destinoTrasLogin(rol: Rol | null, next?: string | null): string {
  return retornoSeguro(next, rol) ?? inicioDe(rol);
}
