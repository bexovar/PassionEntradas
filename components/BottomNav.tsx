"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, activeHref } from "@/components/nav-items";

// Barra de navegación fija abajo (tipo app nativa), SOLO móvil: en md+ las
// secciones viven en el TopNav del header. La tab activa se resalta según
// la ruta. Se renderiza solo para administradores.
export default function BottomNav() {
  const pathname = usePathname();
  const active = activeHref(pathname);

  return (
    <nav
      aria-label="Secciones"
      // bg-ink sólido (no surface-ink): los gradientes complejos en un
      // elemento fixed parpadean al scrollear en iOS Safari. nav-fixed le
      // da capa de composición propia.
      className="nav-fixed fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {/* Compacta: ~46px de alto. Iconos 16px, píldora chica y labels 10px
          para que la barra acompañe sin comerse la pantalla. */}
      <div className="mx-auto flex w-full max-w-5xl items-stretch gap-1 px-3 py-1">
        {NAV_ITEMS.map((item) => {
          const isActive = active === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={`flex flex-1 flex-col items-center py-0.5 text-[10px] font-semibold transition-colors [&_svg]:h-4 [&_svg]:w-4 ${
                isActive ? "text-white" : "text-white/45 hover:text-white/75"
              }`}
            >
              <span
                className={`flex h-6 w-11 items-center justify-center rounded-full transition-colors ${
                  isActive ? "bg-cobalt" : "bg-transparent"
                }`}
              >
                {item.icon}
              </span>
              {item.corto ?? item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
