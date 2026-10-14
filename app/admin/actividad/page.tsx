import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminSupabase } from "@/lib/supabase/server";
import { getRol } from "@/lib/auth";
import AppHeader from "@/components/AppHeader";
import BottomNav from "@/components/BottomNav";
import AccesosTabs from "@/components/admin/AccesosTabs";
import { isMock, MOCK_USER } from "@/lib/mock-db";
import { usuarioVerificado } from "@/lib/usuario-verificado";
import { leerActividad, type Actividad } from "@/lib/actividad";

export const dynamic = "force-dynamic";

// Pantalla Actividad (SOLO administrador): todo lo que cambió en la app,
// quién y cuándo. Filtros por texto (código, persona, frase), tipo y fecha.
// Formulario GET sin JavaScript: los filtros quedan en la URL.

const LIMITE = 300;
const ZONA = "America/Argentina/Buenos_Aires";

const ENTIDADES: { value: string; label: string }[] = [
  { value: "", label: "Todo" },
  { value: "operacion", label: "Operaciones y pedidos" },
  { value: "consulta", label: "Consultas" },
  { value: "ticket", label: "Entradas" },
  { value: "solicitud", label: "Solicitudes de acceso" },
  { value: "usuario", label: "Equipo, cuentas e ingresos" },
  { value: "config", label: "Configuración" },
];

const PERIODOS: { value: string; label: string; dias: number | null }[] = [
  { value: "7", label: "Últimos 7 días", dias: 7 },
  { value: "1", label: "Hoy y ayer", dias: 1 },
  { value: "30", label: "Últimos 30 días", dias: 30 },
  { value: "todo", label: "Todo", dias: null },
];

const ROL: Record<string, string> = { administrador: "admin", moderador: "moderador", cliente: "cliente" };

function uno(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function dia(iso: string): string {
  return new Date(iso).toLocaleDateString("es-AR", {
    timeZone: ZONA,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-AR", { timeZone: ZONA, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function quien(a: Actividad): string {
  return a.actor_nombre ?? a.actor_email ?? (a.origen === "sistema" ? "Sistema" : "Sin cuenta");
}

export default async function ActividadPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  let email: string | null | undefined;
  if (isMock()) {
    email = MOCK_USER.email;
  } else {
    const user = await usuarioVerificado();
    if (!user) redirect("/ingresar");
    if (getRol(user) !== "administrador") redirect("/moderador");
    email = user.email;
  }

  const q = uno(searchParams?.q).trim();
  const entidad = ENTIDADES.some((e) => e.value === uno(searchParams?.entidad)) ? uno(searchParams?.entidad) : "";
  const periodo = PERIODOS.find((p) => p.value === uno(searchParams?.periodo)) ?? PERIODOS[0];
  const desde =
    periodo.dias == null ? undefined : new Date(Date.now() - periodo.dias * 24 * 60 * 60 * 1000).toISOString();

  const filas = await leerActividad(isMock() ? null : createAdminSupabase(), {
    q: q || undefined,
    entidad: entidad || undefined,
    desde,
    limite: LIMITE,
  });

  // Agrupadas por día (hora de Argentina), más nuevo primero.
  const grupos: { dia: string; filas: Actividad[] }[] = [];
  for (const a of filas) {
    const d = dia(a.created_at);
    const g = grupos[grupos.length - 1];
    if (g && g.dia === d) g.filas.push(a);
    else grupos.push({ dia: d, filas: [a] });
  }

  const campo =
    "w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-body outline-none focus:border-cobalt";

  return (
    <main className="min-h-svh pb-16 md:pb-10">
      <AppHeader subtitle="Actividad" email={email} nav />
      <div className="mx-auto w-full max-w-5xl px-4 py-5">
        <AccesosTabs activa="actividad" />

        <form method="get" className="mb-4 grid gap-2 rounded-xl border border-line bg-white p-3 shadow-sm sm:grid-cols-[1fr_auto_auto_auto]">
          <label className="sr-only" htmlFor="act-q">Buscar</label>
          <input id="act-q" name="q" defaultValue={q} placeholder="Código, persona o texto" className={campo} />
          <label className="sr-only" htmlFor="act-entidad">Tipo</label>
          <select id="act-entidad" name="entidad" defaultValue={entidad} className={campo}>
            {ENTIDADES.map((e) => (
              <option key={e.value} value={e.value}>{e.label}</option>
            ))}
          </select>
          <label className="sr-only" htmlFor="act-periodo">Período</label>
          <select id="act-periodo" name="periodo" defaultValue={periodo.value} className={campo}>
            {PERIODOS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
          <button type="submit" className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white">
            Filtrar
          </button>
        </form>

        {filas.length === 0 ? (
          <p className="rounded-xl border border-line bg-white px-4 py-6 text-center text-sm text-muted">
            Nada registrado con estos filtros.
          </p>
        ) : (
          <div className="space-y-4">
            {grupos.map((g) => (
              <section key={g.dia}>
                <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted first-letter:uppercase">{g.dia}</h2>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white shadow-sm">
                  {g.filas.map((a) => {
                    const rechazado = a.accion.endsWith(".rechazado");
                    return (
                      <li key={a.id} className="px-3 py-2.5 text-sm">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <time className="font-mono text-[11px] text-muted" dateTime={a.created_at}>
                            {hora(a.created_at)}
                          </time>
                          <span className="font-semibold text-body [overflow-wrap:anywhere]">{quien(a)}</span>
                          {a.actor_rol && (
                            <span className="rounded bg-canvas px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted">
                              {ROL[a.actor_rol] ?? a.actor_rol}
                            </span>
                          )}
                          {a.codigo && (a.entidad === "operacion" || a.entidad === "consulta") && (
                            <Link
                              href={`/admin?q=${encodeURIComponent(a.codigo)}`}
                              className="font-mono text-[11px] font-semibold text-cobalt hover:underline"
                            >
                              {a.codigo}
                            </Link>
                          )}
                          {a.codigo && a.entidad !== "operacion" && a.entidad !== "consulta" && (
                            <span className="font-mono text-[11px] text-muted [overflow-wrap:anywhere]">{a.codigo}</span>
                          )}
                        </div>
                        <p className={`mt-0.5 leading-snug [overflow-wrap:anywhere] ${rechazado ? "text-[#B5304B]" : "text-[#4A4E5E]"}`}>
                          {a.resumen}
                        </p>
                        {Object.keys(a.detalle ?? {}).length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] font-medium text-muted">Detalle</summary>
                            <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-canvas p-2 font-mono text-[11px] text-[#4A4E5E]">
                              {JSON.stringify(a.detalle, null, 2)}
                            </pre>
                          </details>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
            {filas.length >= LIMITE && (
              <p className="text-center text-xs text-muted">
                Se muestran las últimas {LIMITE}. Filtrá por código, persona o fecha para ver más atrás.
              </p>
            )}
          </div>
        )}
      </div>
      <BottomNav />
    </main>
  );
}
