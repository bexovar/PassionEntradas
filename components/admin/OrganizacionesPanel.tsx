"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmarBoton from "@/components/ConfirmarBoton";
import { ETIQUETA_TIPO_ORGANIZACION } from "@/lib/acceso";
import { cuitLegible, ROL_ORG_LABEL, type RolOrganizacion } from "@/lib/organizaciones";
import type { OrganizacionFicha } from "@/app/api/organizaciones/route";

// Organizaciones (TKT-10): cada agencia con sus usuarios y su rol. El admin
// cambia roles y fusiona duplicadas; el moderador solo mira.

const btnGhost =
  "rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-[#4A4E5E] transition-colors hover:bg-canvas disabled:opacity-50";

export default function OrganizacionesPanel({ esAdmin }: { esAdmin: boolean }) {
  const [orgs, setOrgs] = useState<OrganizacionFicha[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [destino, setDestino] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<{ tipo: "ok" | "error"; msg: string } | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch("/api/organizaciones", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar las organizaciones");
      setOrgs(data.organizaciones ?? []);
    } catch (e) {
      setOrgs([]);
      setAviso({ tipo: "error", msg: (e as Error).message });
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function enviar(clave: string, body: object, ok: string) {
    setBusy(clave);
    setAviso(null);
    try {
      const res = await fetch("/api/organizaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAviso({ tipo: "error", msg: data.error ?? "No se pudo guardar" });
        return;
      }
      setAviso({ tipo: "ok", msg: ok });
      await cargar();
    } catch {
      setAviso({ tipo: "error", msg: "Error de red. Reintentá." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-8" aria-labelledby="orgs-h">
      <div className="mb-3 flex items-end justify-between gap-2">
        <div>
          <h2 id="orgs-h" className="text-lg font-bold text-ink">
            Organizaciones
          </h2>
          <p className="text-xs text-muted">
            Cada usuario es de una organización. El administrador de la organización ve los pedidos de todos sus
            vendedores en Mis pedidos.
          </p>
        </div>
      </div>

      {aviso && (
        <p
          role="status"
          className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${
            aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
          }`}
        >
          {aviso.msg}
        </p>
      )}

      {orgs === null ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : orgs.length === 0 ? (
        <p className="text-sm text-muted">Todavía no hay organizaciones. Se crean al aprobar una solicitud.</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {orgs.map((o) => (
            <li key={o.id} className="card-shadow rounded-2xl bg-white p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-ink">{o.nombre}</p>
                <p className="text-[11px] text-muted">
                  {o.tipo ? ETIQUETA_TIPO_ORGANIZACION[o.tipo] : "Sin tipo"}
                  {o.cuit && ` · CUIT ${cuitLegible(o.cuit)}`} · {o.operaciones}{" "}
                  {o.operaciones === 1 ? "operación" : "operaciones"}
                </p>
              </div>

              <ul className="mt-2 divide-y divide-line">
                {o.miembros.map((m) => {
                  const otro: RolOrganizacion = m.rol === "admin" ? "vendedor" : "admin";
                  return (
                    <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
                      <span className="min-w-0">
                        <span className="font-medium text-body">{m.nombre ?? m.email}</span>
                        {m.nombre && m.email && <span className="text-xs text-muted"> · {m.email}</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted">{ROL_ORG_LABEL[m.rol]}</span>
                        {esAdmin && (
                          <button
                            type="button"
                            className={btnGhost}
                            disabled={busy !== null}
                            onClick={() =>
                              enviar(
                                `rol-${m.user_id}`,
                                { accion: "rol", user_id: m.user_id, rol: otro },
                                `${m.nombre ?? m.email} ahora es ${ROL_ORG_LABEL[otro].toLowerCase()}`
                              )
                            }
                          >
                            Pasar a {ROL_ORG_LABEL[otro].toLowerCase()}
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
                {o.miembros.length === 0 && <li className="py-1.5 text-xs text-muted">Sin usuarios.</li>}
              </ul>

              {esAdmin && orgs.length > 1 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-dashed border-line pt-3">
                  <label className="text-xs text-muted" htmlFor={`fusion-${o.id}`}>
                    ¿Duplicada? Fusionar en
                  </label>
                  <select
                    id={`fusion-${o.id}`}
                    value={destino[o.id] ?? ""}
                    onChange={(e) => setDestino((d) => ({ ...d, [o.id]: e.target.value }))}
                    className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="">Elegí la organización…</option>
                    {orgs
                      .filter((x) => x.id !== o.id)
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.nombre}
                          {x.cuit ? ` (${cuitLegible(x.cuit)})` : ""}
                        </option>
                      ))}
                  </select>
                  <ConfirmarBoton
                    onConfirm={() => {
                      const d = orgs.find((x) => x.id === destino[o.id]);
                      if (d)
                        enviar(
                          `fusion-${o.id}`,
                          { accion: "fusionar", origen: o.id, destino: d.id },
                          `"${o.nombre}" quedó fusionada en "${d.nombre}"`
                        );
                    }}
                    disabled={!destino[o.id] || busy !== null}
                    pregunta={`¿Pasar todo de "${o.nombre}" a la otra? No se deshace.`}
                    si="Sí, fusionar"
                    className={btnGhost}
                    armadoClassName="flex flex-wrap items-center gap-2"
                    preguntaClassName="text-xs font-semibold text-ink"
                    siClassName="rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-white"
                    noClassName={btnGhost}
                  >
                    Fusionar
                  </ConfirmarBoton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
