"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, activeHref } from "@/components/nav-items";

// Tabs de sección en el header, SOLO desktop (md+): en móvil la navegación
// vive en la BottomNav. Mismo lenguaje visual: píldora violeta en la activa.
export default function TopNav() {
  const pathname = usePathname();
  const active = activeHref(pathname);

  return (
    <nav aria-label="Secciones" className="hidden items-center gap-1 md:flex">
      {NAV_ITEMS.map((item) => {
        const isActive = active === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            title={item.label}
            className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm xl:px-3 font-semibold transition-colors ${
              isActive
                ? "bg-cobalt text-white"
                : "text-white/50 hover:bg-white/10 hover:text-white/85"
            }`}
          >
            {item.icon}
            {/* Hasta xl solo el ícono: con cinco secciones los nombres no
                entran en una fila con las acciones (el header tiene tope de
                6xl, así que más pantalla no suma lugar). */}
            <span className="sr-only xl:not-sr-only">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
