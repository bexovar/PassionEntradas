// Secciones del admin, compartidas por BottomNav (móvil) y TopNav (desktop).
//
// Son CINCO como máximo, y en la barra de abajo cada nombre tiene que entrar
// en ~56px a 320px de ancho (10px de letra). Una quinta con un nombre largo
// ("Consultas") partía la barra en dos líneas: las consultas viven ahora
// dentro del Panel. "Configuración" no entra: abajo dice "Ajustes" (`corto`).

// `rutas`: otras páginas que también marcan la sección como activa.
// `corto`: el nombre en la barra de abajo (móvil), si el completo no entra.
export type NavItem = { href: string; label: string; corto?: string; icon: React.ReactNode; rutas?: string[] };

const ICON_CLS = "h-[18px] w-[18px]";

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/admin",
    label: "Panel",
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/moderador",
    label: "Cargar",
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    ),
  },
  {
    href: "/admin/entradas",
    label: "Entradas",
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M3 9a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v1a2 2 0 0 0 0 4v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1a2 2 0 0 0 0-4Z" />
        <path d="M13 7v2m0 6v2" strokeDasharray="1.5 2.5" />
      </svg>
    ),
  },
  {
    href: "/admin/solicitudes",
    label: "Accesos",
    // Solicitudes, Equipo y Clientes son pestañas de la misma sección (una
    // quinta entrada en la barra la partía en dos líneas).
    rutas: ["/admin/equipo", "/admin/clientes", "/admin/actividad"],
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />
        <path d="m3.5 6.5 8.5 6 8.5-6" />
      </svg>
    ),
  },
  {
    // Cotización y margen, cotizaciones y pagos, carrusel de la home.
    href: "/admin/configuracion",
    label: "Configuración",
    corto: "Ajustes",
    icon: (
      <svg className={ICON_CLS} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
        <circle cx="15" cy="6" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="17" cy="18" r="2" />
      </svg>
    ),
  },
];

// La ruta más específica gana: /admin/entradas no debe activar también /admin.
export function activeHref(pathname: string): string | null {
  const dentro = (r: string) => pathname === r || pathname.startsWith(`${r}/`);
  const porRuta = NAV_ITEMS.find((i) => i.rutas?.some(dentro));
  if (porRuta) return porRuta.href;
  return (
    [...NAV_ITEMS]
      .sort((a, b) => b.href.length - a.href.length)
      .find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`))
      ?.href ?? null
  );
}
