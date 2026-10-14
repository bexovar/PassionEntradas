import Link from "next/link";

// Pestañas de la sección Accesos: las solicitudes de la landing, el equipo,
// los clientes y el registro de actividad. Son páginas aparte (cada una carga lo suyo) bajo la misma
// entrada de la barra.
const TABS = [
  { key: "solicitudes", href: "/admin/solicitudes", label: "Solicitudes" },
  { key: "equipo", href: "/admin/equipo", label: "Equipo" },
  { key: "clientes", href: "/admin/clientes", label: "Clientes" },
  { key: "actividad", href: "/admin/actividad", label: "Actividad" },
] as const;

export type AccesosTab = (typeof TABS)[number]["key"];

export default function AccesosTabs({ activa }: { activa: AccesosTab }) {
  return (
    <nav
      aria-label="Accesos"
      className="mb-4 grid grid-cols-4 gap-1 rounded-xl border border-line bg-white p-1 shadow-sm"
    >
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === activa ? "page" : undefined}
          className={`rounded-lg px-1 py-1.5 text-center text-xs font-semibold transition-colors ${
            t.key === activa ? "bg-ink text-white" : "text-[#4A4E5E] hover:bg-canvas"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
