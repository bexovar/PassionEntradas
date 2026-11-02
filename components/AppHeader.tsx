import Link from "next/link";
import LogoutButton from "@/components/admin/LogoutButton";
import TopNav from "@/components/TopNav";
import CampanaEquipo from "@/components/admin/CampanaEquipo";

type Props = {
  subtitle: string;
  email?: string | null;
  // Muestra las tabs de sección en desktop (md+). En móvil la navegación
  // vive en la BottomNav; el moderador puro no lleva navegación.
  nav?: boolean;
};

// Header mínimo: identidad y sesión. En desktop, si nav está activo, las
// secciones aparecen como tabs junto a la marca.
//
// Pegado al tope (sticky): el panel es una lista larga de operaciones y, al
// scrollear, el header se iba y había que volver arriba para cambiar de
// sección o salir. z-30 lo deja por debajo de los modales (z-50) y de los
// toasts, así que no tapa nada. El padding de safe-area se mantiene para que
// en iOS no quede debajo de la barra de estado.
export default function AppHeader({ subtitle, email, nav = false }: Props) {
  return (
    <header className="surface-ink sticky top-0 z-30 pt-[env(safe-area-inset-top)] text-white">
      {/* flex-wrap solo en celular: si la marca + acciones no entran, la fila
          de acciones baja completa en vez de cortarse en el borde. Desde
          tablet va todo en UNA fila (con la campana ya no entraba en 5xl y
          las acciones quedaban abajo de las secciones). */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 md:flex-nowrap">
        <div className="flex min-w-0 items-center gap-2.5 md:gap-6">
          <div className="flex items-center gap-2.5">
            {/* Marca TicketMirror (la de la tienda): ▚ flare + MIRROR en cobalto
                aclarado para que contraste sobre la tinta del header. */}
            <span
              className="shrink-0 text-base text-[#FF3B2E] [letter-spacing:-0.2em]"
              aria-hidden
            >
              ▚
            </span>
            {/* Misma fuente que el logo de la tienda: Archivo 900, 14px,
                tracking .14em (el .wm de tienda.css). */}
            <span className="whitespace-nowrap font-body text-sm font-black uppercase tracking-[0.14em]">
              Ticket<span className="text-[#7B8CFF]">Mirror</span>
            </span>
            {/* Con tabs en desktop, el subtítulo sobra ahí (la tab activa ya
                dice dónde estás); se muestra solo en el rango sm–md. */}
            <span
              className={`hidden truncate text-sm text-white/50 sm:inline ${
                nav ? "md:hidden" : ""
              }`}
            >
              · {subtitle}
            </span>
          </div>
          {nav && <TopNav />}
        </div>
        {/* Acciones de sesión: misma altura para las tres (los <button>
            reciben min-height 40px del global táctil y los <Link> no — eso
            las dejaba desparejas en móvil). 40px en táctil, 36px en desktop. */}
        <div className="flex items-center gap-2">
          {/* Con las tabs el email no entra al lado de los cinco nombres:
              queda en el tooltip de "Mi cuenta". */}
          {email && !nav && (
            <span title={email} className="hidden max-w-[22ch] truncate font-mono text-xs text-white/50 xl:inline">
              {email}
            </span>
          )}
          {/* Ver la tienda desde el panel: SIEMPRE presente. Abre en una
              pestaña nueva (target=_blank) para no cerrar el panel, y como
              carga completa trae el CSS de la tienda (no el Tailwind del
              panel). */}
          <a
            href="/entradas"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-xl bg-cobalt px-3.5 text-xs font-semibold text-white transition-colors hover:bg-cobalt-deep md:h-9"
          >
            Tienda ↗
          </a>
          {/* La home pública, también en pestaña nueva: de ahí se copia el
              link de solicitud para mandárselo a alguien. */}
          <a
            href="/"
            target="_blank"
            rel="noopener noreferrer"
            title="Home pública (link de solicitud de acceso)"
            className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-xl border border-white/15 bg-white/5 px-3.5 text-xs font-medium text-white/85 transition-colors hover:bg-white/15 md:h-9"
          >
            Home ↗
          </a>
          {/* Avisos del equipo (pedidos nuevos, recordatorios…). */}
          <CampanaEquipo />
          <Link
            href="/admin/cuenta"
            title={email ? `Mi cuenta · ${email}` : "Mi cuenta"}
            aria-label="Mi cuenta"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-white/85 transition-colors hover:bg-white/15 md:h-9 md:w-9"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
            </svg>
          </Link>
          <LogoutButton />
        </div>
      </div>
      <div className="holo-strip" aria-hidden />
    </header>
  );
}
