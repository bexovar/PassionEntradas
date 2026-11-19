"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as KeyEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ETIQUETA_TIPO_ORGANIZACION } from "@/lib/acceso";
import { coincidenciaBusqueda, type FichaAgencia, type FichaPersona } from "@/lib/clientes";
import { fechaDia } from "@/lib/fechas";
import { formatMonto, type Moneda } from "@/lib/operaciones";
import {
  cuitLegible,
  MOTIVO_DUPLICADA_LABEL,
  ROL_ORG_LABEL,
  validarNombreOrg,
  type PosibleDuplicada,
} from "@/lib/organizaciones";
import { urlPanel } from "@/lib/panel-filtros";

// Pantalla Clientes: las agencias primero, cada una con su gente adentro.
// Lista compacta: una línea por agencia con sus números, que se abre para ver
// a las personas. Lo de todos los días está a la vista (Ver pedidos); lo que
// se usa poco (cambiar nombre, juntar, rol, revocar) va en el menú ⋯.
// El moderador ve lo mismo sin acciones.

const btnGhost =
  "inline-flex items-center justify-center rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold text-[#4A4E5E] transition-colors hover:bg-canvas disabled:opacity-50";
const btnPrimario =
  "inline-flex items-center justify-center rounded-lg bg-ink px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-ink-soft disabled:opacity-50";
const btnPeligro =
  "inline-flex items-center justify-center rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50";

const CLAVE_DESCARTADAS = "tm.clientes.duplicadasDescartadas";

type Aviso = { tipo: "ok" | "error"; msg: string };

type Dialogo =
  | { tipo: "renombrar"; agencia: FichaAgencia }
  | { tipo: "juntar"; agencia: FichaAgencia; otra?: FichaAgencia }
  | { tipo: "acceso"; persona: FichaPersona; accion: "revocar" | "reactivar" };

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

function totalesTexto(t: { moneda: string; total: number }[]): string | null {
  if (t.length === 0) return null;
  return t.map((x) => formatMonto(x.total, x.moneda as Moneda, { sinDecimales: true })).join(" + ");
}

function MetaAgencia({ a }: { a: Pick<FichaAgencia, "tipo" | "cuit"> }) {
  return (
    <>
      {a.tipo ? ETIQUETA_TIPO_ORGANIZACION[a.tipo] : "Sin tipo"} ·{" "}
      <span className="whitespace-nowrap">{a.cuit ? `CUIT ${cuitLegible(a.cuit)}` : "sin CUIT"}</span>
    </>
  );
}

export default function ClientesAgencias({
  agencias,
  sinAgencia,
  duplicadas,
  esAdmin,
}: {
  agencias: FichaAgencia[];
  sinAgencia: FichaPersona[];
  duplicadas: PosibleDuplicada[];
  esAdmin: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [abiertas, setAbiertas] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [verDuplicadas, setVerDuplicadas] = useState(false);
  // Pares que el admin marcó "no son la misma". Se guardan en este navegador.
  const [descartadas, setDescartadas] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    try {
      const crudo = window.localStorage.getItem(CLAVE_DESCARTADAS);
      if (crudo) setDescartadas(new Set(JSON.parse(crudo) as string[]));
    } catch {
      // Sin almacenamiento: se muestran todas.
    }
  }, []);

  const porId = useMemo(() => new Map(agencias.map((a) => [a.id, a])), [agencias]);
  const pendientes = useMemo(
    () => duplicadas.filter((d) => !descartadas.has(d.clave) && porId.has(d.a) && porId.has(d.b)),
    [duplicadas, descartadas, porId]
  );

  function avisar(a: Aviso) {
    setAviso(a);
    window.setTimeout(() => setAviso((x) => (x === a ? null : x)), 5000);
  }

  function descartar(clave: string) {
    setDescartadas((prev) => {
      const sig = new Set(prev).add(clave);
      try {
        window.localStorage.setItem(CLAVE_DESCARTADAS, JSON.stringify(Array.from(sig)));
      } catch {
        // Sin almacenamiento: vale hasta recargar.
      }
      return sig;
    });
  }

  const toggle = (id: string) =>
    setAbiertas((prev) => {
      const sig = new Set(prev);
      if (sig.has(id)) sig.delete(id);
      else sig.add(id);
      return sig;
    });

  async function postOrg(body: object): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch("/api/organizaciones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "No se pudo guardar" };
      return { ok: true };
    } catch {
      return { ok: false, error: "Error de red. Reintentá." };
    }
  }

  async function cambiarRol(p: FichaPersona) {
    if (busy || !p.rol) return;
    const rol = p.rol === "admin" ? "vendedor" : "admin";
    setBusy(p.id);
    const r = await postOrg({ accion: "rol", user_id: p.id, rol });
    setBusy(null);
    if (!r.ok) return avisar({ tipo: "error", msg: r.error });
    avisar({ tipo: "ok", msg: `${p.nombre} ahora es ${ROL_ORG_LABEL[rol].toLowerCase()}.` });
    router.refresh();
  }

  // Lo que se ve: con búsqueda, las agencias que coinciden; si coincide una
  // persona, su agencia aparece abierta y la persona resaltada.
  const visibles = useMemo(() => {
    return agencias
      .map((a) => ({ a, m: coincidenciaBusqueda(a, q) }))
      .filter((x): x is { a: FichaAgencia; m: NonNullable<typeof x.m> } => x.m !== null);
  }, [agencias, q]);
  const sinAgenciaVisibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return sinAgencia;
    return sinAgencia.filter((p) => p.nombre.toLowerCase().includes(t) || p.email.toLowerCase().includes(t));
  }, [sinAgencia, q]);

  const usuarios = agencias.reduce((n, a) => n + a.personas.length, 0) + sinAgencia.length;
  const conAbiertas = agencias.filter((a) => a.abiertas > 0).length;
  const buscando = q.trim() !== "";

  return (
    <section className="card-shadow rounded-2xl">
      <div className="surface-ink punch-b rounded-t-2xl px-5 py-4 text-white">
        <p className="text-[10px] font-medium uppercase tracking-[0.25em] text-white/50">
          {plural(agencias.length, "agencia", "agencias")} · {plural(usuarios, "usuario", "usuarios")} · {conAbiertas}{" "}
          con pedidos abiertos
        </p>
        <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight">Clientes</h2>
      </div>
      <div className="punch-t rounded-b-2xl bg-white">
        <div className="perf-line-light mx-5" />
        <div className="space-y-3 p-4 sm:p-5">
          {aviso && (
            <p
              className={`rounded-lg px-3 py-2 text-sm font-medium ${
                aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
              }`}
              role="status"
            >
              {aviso.msg}
            </p>
          )}

          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar agencia, CUIT, persona o email…"
            aria-label="Buscar agencias y personas"
            className="w-full rounded-xl border border-line bg-white px-3.5 py-2 text-sm shadow-sm outline-none placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/15"
          />

          {esAdmin && pendientes.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                <p className="text-sm text-amber-900">
                  <span className="font-semibold">
                    {plural(pendientes.length, "posible duplicada", "posibles duplicadas")}
                  </span>{" "}
                  para revisar
                  <span className="hidden text-xs text-amber-800 sm:inline"> · mismo CUIT, nombre parecido o mismo email de empresa</span>
                </p>
                <button
                  type="button"
                  onClick={() => setVerDuplicadas((v) => !v)}
                  aria-expanded={verDuplicadas}
                  aria-controls="duplicadas-lista"
                  className="rounded-lg bg-cobalt px-3 py-1.5 text-xs font-semibold text-white hover:bg-cobalt-deep"
                >
                  {verDuplicadas ? "Ocultar" : "Revisar"}
                </button>
              </div>
              {verDuplicadas && (
                <ul id="duplicadas-lista" className="divide-y divide-amber-200 border-t border-amber-200">
                  {pendientes.map((d) => {
                    const a = porId.get(d.a)!;
                    const b = porId.get(d.b)!;
                    return (
                      <li key={d.clave} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">
                            {a.nombre} <span className="font-normal text-muted">y</span> {b.nombre}
                          </p>
                          <p className="text-xs text-amber-900">
                            {d.motivos
                              .map((m) => (m === "dominio" && d.dominio ? `${MOTIVO_DUPLICADA_LABEL[m]} (@${d.dominio})` : MOTIVO_DUPLICADA_LABEL[m]))
                              .join(" · ")}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className={btnGhost}
                            onClick={() => setDialogo({ tipo: "juntar", agencia: a, otra: b })}
                          >
                            Juntar…
                          </button>
                          <button type="button" className={btnGhost} onClick={() => descartar(d.clave)}>
                            No son la misma
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {visibles.length === 0 && sinAgenciaVisibles.length === 0 ? (
            <p className="rounded-xl bg-canvas px-3 py-6 text-center text-sm text-muted">
              {agencias.length === 0 && sinAgencia.length === 0
                ? "Todavía no hay clientes aprobados. Las agencias se crean al aprobar una solicitud."
                : "Ninguna agencia ni persona con eso."}
            </p>
          ) : (
            <ul className="space-y-2">
              {visibles.map(({ a, m }) => {
                const abierta = abiertas.has(a.id) || (buscando && m.personas.size > 0);
                const total = totalesTexto(a.totales);
                return (
                  <li key={a.id} className="rounded-xl border border-line">
                    {/* En el celular las acciones van abajo del nombre; si no, apretaban los números. */}
                    <div className="flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
                      <button
                        type="button"
                        onClick={() => toggle(a.id)}
                        aria-expanded={abierta}
                        aria-controls={`ag-${a.id}`}
                        className="flex min-w-0 flex-1 items-start gap-2 rounded-lg text-left"
                      >
                        <span
                          aria-hidden
                          className={`mt-0.5 inline-block w-3 shrink-0 text-xs text-muted transition-transform ${abierta ? "rotate-90" : ""}`}
                        >
                          ▸
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]">{a.nombre}</span>
                          <span className="block text-[11px] text-muted"><MetaAgencia a={a} /></span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted">
                            <b className="font-semibold text-body">{a.personas.length}</b>{" "}
                            {a.personas.length === 1 ? "usuario" : "usuarios"} ·{" "}
                            <b className="font-semibold text-body">{a.operaciones}</b>{" "}
                            {a.operaciones === 1 ? "pedido" : "pedidos"}
                            {total && <> · <span className="whitespace-nowrap">{total}</span></>}
                            {a.abiertas > 0 && (
                              <span className="mx-1 inline-block whitespace-nowrap rounded-full bg-blue-100 px-2 py-px text-[11px] font-semibold text-blue-800">
                                {a.abiertas} {a.abiertas === 1 ? "abierto" : "abiertos"}
                              </span>
                            )}
                            {a.abiertas > 0 ? "" : " · "}
                            <span className="whitespace-nowrap">
                              {a.ultimoPedido ? `último ${fechaDia(a.ultimoPedido)}` : "sin pedidos"}
                            </span>
                          </span>
                        </span>
                      </button>
                      {esAdmin && (
                        <div className="flex shrink-0 items-center gap-1.5 pl-5 sm:pl-0">
                          {a.ultimoPedido && (
                            <Link
                              href={urlPanel({ filtro: "todas", organizacion: { id: a.id, nombre: a.nombre } })}
                              className={btnGhost}
                            >
                              Ver pedidos
                            </Link>
                          )}
                          <MenuAcciones
                            etiqueta={`Más acciones para ${a.nombre}`}
                            items={[
                              { label: "Cambiar nombre", onSelect: () => setDialogo({ tipo: "renombrar", agencia: a }) },
                              {
                                label: "Juntar con otra agencia…",
                                onSelect: () => setDialogo({ tipo: "juntar", agencia: a }),
                                disabled: agencias.length < 2,
                              },
                            ]}
                          />
                        </div>
                      )}
                    </div>
                    {abierta && (
                      <ListaPersonas
                        id={`ag-${a.id}`}
                        personas={a.personas}
                        resaltadas={buscando ? m.personas : undefined}
                        esAdmin={esAdmin}
                        busy={busy}
                        onRol={cambiarRol}
                        onAcceso={(p, accion) => setDialogo({ tipo: "acceso", persona: p, accion })}
                      />
                    )}
                  </li>
                );
              })}
              {sinAgenciaVisibles.length > 0 && (
                <li className="rounded-xl border border-dashed border-line">
                  <div className="p-3">
                    <p className="text-sm font-semibold text-ink">Sin agencia</p>
                    <p className="text-[11px] text-muted">Clientes que todavía no quedaron en ninguna organización.</p>
                  </div>
                  <ListaPersonas
                    id="ag-sin"
                    personas={sinAgenciaVisibles}
                    esAdmin={esAdmin}
                    busy={busy}
                    onRol={cambiarRol}
                    onAcceso={(p, accion) => setDialogo({ tipo: "acceso", persona: p, accion })}
                  />
                </li>
              )}
            </ul>
          )}
        </div>
      </div>

      {dialogo?.tipo === "renombrar" && (
        <DialogoRenombrar
          agencia={dialogo.agencia}
          onClose={() => setDialogo(null)}
          enviar={(nombre) => postOrg({ accion: "renombrar", id: dialogo.agencia.id, nombre })}
          onListo={(nombre) => {
            setDialogo(null);
            avisar({ tipo: "ok", msg: `La agencia ahora se llama "${nombre}".` });
            router.refresh();
          }}
        />
      )}
      {dialogo?.tipo === "juntar" && (
        <DialogoJuntar
          base={dialogo.agencia}
          otraInicial={dialogo.otra}
          agencias={agencias}
          duplicadas={pendientes}
          onClose={() => setDialogo(null)}
          enviar={(origen, destino) => postOrg({ accion: "fusionar", origen, destino })}
          onListo={(origen, destino) => {
            setDialogo(null);
            setAbiertas((prev) => new Set(prev).add(destino.id));
            avisar({ tipo: "ok", msg: `"${origen.nombre}" quedó junto con "${destino.nombre}".` });
            router.refresh();
          }}
        />
      )}
      {dialogo?.tipo === "acceso" && (
        <DialogoAcceso
          persona={dialogo.persona}
          accion={dialogo.accion}
          onClose={() => setDialogo(null)}
          onListo={(msg) => {
            setDialogo(null);
            avisar({ tipo: "ok", msg });
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function ListaPersonas({
  id,
  personas,
  resaltadas,
  esAdmin,
  busy,
  onRol,
  onAcceso,
}: {
  id: string;
  personas: FichaPersona[];
  resaltadas?: Set<string>;
  esAdmin: boolean;
  busy: string | null;
  onRol: (p: FichaPersona) => void;
  onAcceso: (p: FichaPersona, accion: "revocar" | "reactivar") => void;
}) {
  if (personas.length === 0) {
    return (
      <p id={id} className="mx-3 mb-3 border-t border-dashed border-line pt-2 text-xs text-muted">
        Sin usuarios.
      </p>
    );
  }
  return (
    <ul id={id} className="mx-3 mb-2 divide-y divide-line border-t border-dashed border-line">
      {personas.map((p) => {
        const total = totalesTexto(p.totales);
        const items: ItemMenu[] = [];
        if (p.rol) {
          const otro = p.rol === "admin" ? "vendedor" : "admin";
          items.push({ label: `Pasar a ${ROL_ORG_LABEL[otro].toLowerCase()}`, onSelect: () => onRol(p), disabled: busy !== null });
        }
        if (p.solicitudId) {
          items.push(
            p.revocada
              ? { label: "Reactivar acceso", onSelect: () => onAcceso(p, "reactivar") }
              : { label: "Revocar acceso", onSelect: () => onAcceso(p, "revocar"), peligro: true }
          );
        }
        return (
          <li
            key={p.id}
            className={`flex flex-wrap items-center justify-between gap-2 py-2 pl-5 ${
              resaltadas?.has(p.id) ? "rounded-lg bg-amber-50 pr-2" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="text-sm">
                <span className="font-medium text-body [overflow-wrap:anywhere]">{p.nombre}</span>
                {p.revocada && (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                    Sin acceso
                  </span>
                )}
              </p>
              <p className="text-xs text-muted [overflow-wrap:anywhere]">
                {p.email}
                {" · "}
                {plural(p.operaciones, "pedido", "pedidos")}
                {total && ` · ${total}`}
                {p.abiertas > 0 && ` · ${p.abiertas} ${p.abiertas === 1 ? "abierto" : "abiertos"}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {p.rol && (
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted">
                  {busy === p.id ? "…" : ROL_ORG_LABEL[p.rol]}
                </span>
              )}
              {esAdmin && p.ultimoPedido && (
                <Link
                  href={urlPanel({ filtro: "todas", cliente: { id: p.id, email: p.email.toLowerCase(), nombre: p.nombre } })}
                  className={btnGhost}
                >
                  Ver pedidos
                </Link>
              )}
              {esAdmin && items.length > 0 && <MenuAcciones etiqueta={`Más acciones para ${p.nombre}`} items={items} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Menú ⋯ ---------------------------------------------------------------
// Se dibuja en un portal con posición fija: adentro de la tarjeta, la máscara
// del troquelado lo recortaba en las últimas filas.

type ItemMenu = { label: string; onSelect: () => void; disabled?: boolean; peligro?: boolean };

function MenuAcciones({ etiqueta, items }: { etiqueta: string; items: ItemMenu[] }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const abierto = pos !== null;

  const cerrar = useCallback((devolverFoco: boolean) => {
    setPos(null);
    if (devolverFoco) boton.current?.focus();
  }, []);

  function abrir() {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const alto = items.length * 40 + 12;
    const entraAbajo = r.bottom + 4 + alto <= window.innerHeight;
    setPos({
      top: entraAbajo ? r.bottom + 4 : Math.max(8, r.top - 4 - alto),
      right: Math.max(8, window.innerWidth - r.right),
    });
  }

  useEffect(() => {
    if (!abierto) return;
    menu.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !boton.current?.contains(t)) cerrar(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar(true);
      }
    };
    const mover = () => cerrar(false);
    document.addEventListener("pointerdown", fuera);
    document.addEventListener("keydown", tecla);
    window.addEventListener("scroll", mover, true);
    window.addEventListener("resize", mover);
    return () => {
      document.removeEventListener("pointerdown", fuera);
      document.removeEventListener("keydown", tecla);
      window.removeEventListener("scroll", mover, true);
      window.removeEventListener("resize", mover);
    };
  }, [abierto, cerrar]);

  function flechas(e: KeyEvent<HTMLDivElement>) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const botones = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
    const i = botones.indexOf(document.activeElement as HTMLButtonElement);
    const sig = e.key === "ArrowDown" ? (i + 1) % botones.length : (i - 1 + botones.length) % botones.length;
    botones[sig]?.focus();
  }

  return (
    <>
      <button
        ref={boton}
        type="button"
        onClick={() => (abierto ? cerrar(false) : abrir())}
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        className={`${btnGhost} px-2.5 text-sm leading-none`}
      >
        <span aria-hidden>⋯</span>
      </button>
      {pos &&
        createPortal(
          <div
            ref={menu}
            role="menu"
            aria-label={etiqueta}
            onKeyDown={flechas}
            style={{ top: pos.top, right: pos.right }}
            className="fixed z-50 min-w-[200px] rounded-xl border border-line bg-white p-1 shadow-xl"
          >
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  // El foco vuelve al ⋯ antes de abrir un diálogo, así al
                  // cerrarlo el diálogo lo devuelve ahí.
                  cerrar(true);
                  it.onSelect();
                }}
                className={`block w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-canvas focus:bg-canvas focus:outline-none disabled:opacity-40 ${
                  it.peligro ? "text-amber-700" : "text-body"
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </>
  );
}

// ---- Diálogos ----------------------------------------------------------------

function Modal({
  titulo,
  subtitulo,
  onClose,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const cerrar = useRef(onClose);
  cerrar.current = onClose;

  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    caja.current?.querySelector<HTMLElement>("input, button:not([disabled])")?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar.current();
    };
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("keydown", tecla);
      previo?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 sm:items-center"
      onClick={onClose}
      // Abierto, el refresco automático de la página espera (ver AutoRefresh).
      data-editando=""
    >
      <div
        ref={caja}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-clientes-titulo"
        className="card-shadow flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="surface-ink px-5 py-4 text-white">
          <h2 id="dlg-clientes-titulo" className="font-display text-lg font-bold tracking-tight">
            {titulo}
          </h2>
          {subtitulo && <p className="mt-0.5 text-xs text-white/60 [overflow-wrap:anywhere]">{subtitulo}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}

function ErrorDialogo({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
      {msg}
    </p>
  );
}

function DialogoRenombrar({
  agencia,
  onClose,
  enviar,
  onListo,
}: {
  agencia: FichaAgencia;
  onClose: () => void;
  enviar: (nombre: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onListo: (nombre: string) => void;
}) {
  const [nombre, setNombre] = useState(agencia.nombre);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const v = validarNombreOrg(nombre);
    if (!v.ok) return setError(v.error);
    if (v.nombre === agencia.nombre) return onClose();
    setEnviando(true);
    setError(null);
    const r = await enviar(v.nombre);
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    onListo(v.nombre);
  }

  return (
    <Modal titulo="Cambiar nombre" subtitulo={agencia.nombre} onClose={onClose}>
      <form onSubmit={guardar} className="space-y-3">
        <label className="block">
          <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Nombre de la agencia</span>
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={120}
            className="mt-1 w-full rounded-xl border border-line px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        </label>
        <p className="text-xs text-muted">Lo ven sus usuarios en Mis pedidos. No cambia sus pedidos ni su CUIT.</p>
        <ErrorDialogo msg={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className={btnPrimario} disabled={enviando}>
            {enviando ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// Cuál conviene que quede por defecto: la que tiene más pedidos y gente, y
// entre iguales la que tiene CUIT y tipo cargados.
function peso(a: FichaAgencia): number {
  return a.operaciones * 10 + a.personas.length + (a.cuit ? 0.5 : 0) + (a.tipo ? 0.25 : 0);
}

function DialogoJuntar({
  base,
  otraInicial,
  agencias,
  duplicadas,
  onClose,
  enviar,
  onListo,
}: {
  base: FichaAgencia;
  otraInicial?: FichaAgencia;
  agencias: FichaAgencia[];
  duplicadas: PosibleDuplicada[];
  onClose: () => void;
  enviar: (origen: string, destino: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  onListo: (origen: FichaAgencia, destino: FichaAgencia) => void;
}) {
  const [otra, setOtraState] = useState<FichaAgencia | null>(otraInicial ?? null);
  const [queda, setQueda] = useState<string>(() =>
    otraInicial && peso(otraInicial) > peso(base) ? otraInicial.id : base.id
  );
  const [busq, setBusq] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function setOtra(o: FichaAgencia | null) {
    setOtraState(o);
    setError(null);
    if (o) setQueda(peso(o) > peso(base) ? o.id : base.id);
  }

  const porId = useMemo(() => new Map(agencias.map((a) => [a.id, a])), [agencias]);
  const sugeridas = useMemo(
    () =>
      duplicadas
        .filter((d) => d.a === base.id || d.b === base.id)
        .map((d) => ({ ag: porId.get(d.a === base.id ? d.b : d.a), d }))
        .filter((x): x is { ag: FichaAgencia; d: PosibleDuplicada } => !!x.ag),
    [duplicadas, base.id, porId]
  );
  const buscandoOtra = busq.trim() !== "";
  // Sin búsqueda: las sugeridas arriba y el resto abajo. Con búsqueda, una
  // sola lista con todo lo que coincide.
  const lista = useMemo(() => {
    const sug = new Set(sugeridas.map((s) => s.ag.id));
    return agencias.filter(
      (a) => a.id !== base.id && (buscandoOtra || !sug.has(a.id)) && coincidenciaBusqueda(a, busq) !== null
    );
  }, [agencias, base.id, sugeridas, busq, buscandoOtra]);

  if (!otra) {
    const opcion = (a: FichaAgencia, motivo?: string) => (
      <li key={a.id}>
        <button
          type="button"
          onClick={() => setOtra(a)}
          className="w-full rounded-xl border border-line px-3 py-2 text-left transition-colors hover:bg-canvas"
        >
          <span className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]">{a.nombre}</span>
          <span className="block text-[11px] text-muted">
            <MetaAgencia a={a} /> · {plural(a.personas.length, "usuario", "usuarios")} ·{" "}
            {plural(a.operaciones, "pedido", "pedidos")}
          </span>
          {motivo && <span className="mt-0.5 block text-[11px] font-semibold text-amber-800">{motivo}</span>}
        </button>
      </li>
    );
    return (
      <Modal key="elegir" titulo="Juntar con otra agencia" subtitulo={base.nombre} onClose={onClose}>
        <div className="space-y-3">
          <p className="text-sm text-body">¿Con qué agencia es la misma?</p>
          <input
            type="search"
            value={busq}
            onChange={(e) => setBusq(e.target.value)}
            placeholder="Buscar agencia, CUIT, persona o email…"
            aria-label="Buscar la otra agencia"
            className="w-full rounded-xl border border-line px-3.5 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
          {sugeridas.length > 0 && !buscandoOtra && (
            <div>
              <p className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Sugeridas</p>
              <ul className="space-y-1.5">
                {sugeridas.map(({ ag, d }) =>
                  opcion(
                    ag,
                    d.motivos
                      .map((m) => (m === "dominio" && d.dominio ? `${MOTIVO_DUPLICADA_LABEL[m]} (@${d.dominio})` : MOTIVO_DUPLICADA_LABEL[m]))
                      .join(" · ")
                  )
                )}
              </ul>
            </div>
          )}
          <div>
            {sugeridas.length > 0 && !buscandoOtra && lista.length > 0 && (
              <p className="mb-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Otras agencias</p>
            )}
            {lista.length === 0 ? (
              buscandoOtra || sugeridas.length === 0 ? (
                <p className="rounded-xl bg-canvas px-3 py-4 text-center text-sm text-muted">Ninguna agencia con eso.</p>
              ) : null
            ) : (
              <ul className="space-y-1.5">{lista.map((a) => opcion(a))}</ul>
            )}
          </div>
          <div className="flex justify-end">
            <button type="button" className={btnGhost} onClick={onClose}>
              Cancelar
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  const destino = queda === otra.id ? otra : base;
  const origen = destino === base ? otra : base;

  async function juntar() {
    setEnviando(true);
    setError(null);
    const r = await enviar(origen.id, destino.id);
    setEnviando(false);
    if (!r.ok) return setError(r.error);
    onListo(origen, destino);
  }

  return (
    <Modal key="confirmar" titulo="Juntar agencias" subtitulo={`${base.nombre} y ${otra.nombre}`} onClose={onClose}>
      <div className="space-y-4">
        <fieldset>
          <legend className="mb-1.5 text-sm text-body">¿Qué nombre queda?</legend>
          <div className="space-y-1.5">
            {[base, otra].map((a) => (
              <label
                key={a.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 ${
                  queda === a.id ? "border-cobalt bg-blue-50/60" : "border-line"
                }`}
              >
                <input
                  type="radio"
                  name="queda"
                  value={a.id}
                  checked={queda === a.id}
                  onChange={() => setQueda(a.id)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink [overflow-wrap:anywhere]">{a.nombre}</span>
                  <span className="block text-[11px] text-muted">
                    <MetaAgencia a={a} /> · {plural(a.personas.length, "usuario", "usuarios")} ·{" "}
                    {plural(a.operaciones, "pedido", "pedidos")}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="rounded-xl bg-canvas px-3.5 py-3 text-sm text-body">
          <p>
            Todo lo de <b className="[overflow-wrap:anywhere]">{origen.nombre}</b> pasa a{" "}
            <b className="[overflow-wrap:anywhere]">{destino.nombre}</b>: {plural(origen.personas.length, "usuario", "usuarios")} y
            todos sus pedidos.
          </p>
          <p className="mt-1.5 text-xs text-muted">
            Cada usuario conserva su rol. Queda el tipo y el CUIT de {destino.nombre}; si hace falta, después le cambiás el
            nombre. {origen.nombre} deja de aparecer en la lista.
          </p>
        </div>
        <p className="text-xs font-semibold text-amber-800">No se puede deshacer.</p>
        <ErrorDialogo msg={error} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {otraInicial ? (
            <span />
          ) : (
            <button type="button" className="text-xs font-semibold text-cobalt hover:underline" onClick={() => setOtra(null)}>
              ← Elegir otra agencia
            </button>
          )}
          <div className="flex gap-2">
            <button type="button" className={btnGhost} onClick={onClose}>
              Cancelar
            </button>
            <button type="button" className={btnPeligro} onClick={juntar} disabled={enviando}>
              {enviando ? "Juntando…" : "Juntar"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function DialogoAcceso({
  persona,
  accion,
  onClose,
  onListo,
}: {
  persona: FichaPersona;
  accion: "revocar" | "reactivar";
  onClose: () => void;
  onListo: (msg: string) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Mismo endpoint que Accesos: el acceso del cliente vive en su solicitud.
  async function confirmar() {
    if (!persona.solicitudId) return;
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/acceso/${persona.solicitudId}/revocar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "No se pudo cambiar el acceso");
        return;
      }
      onListo(accion === "revocar" ? `${persona.nombre} ya no puede entrar.` : `${persona.nombre} puede volver a entrar.`);
    } catch {
      setError("Error de red. Reintentá.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={accion === "revocar" ? "Revocar acceso" : "Reactivar acceso"}
      subtitulo={`${persona.nombre} · ${persona.email}`}
      onClose={onClose}
    >
      <div className="space-y-3">
        <p className="text-sm text-body">
          {accion === "revocar"
            ? "Deja de poder entrar hasta que lo reactives. Sus pedidos y su agencia no cambian, y el resto de su agencia sigue entrando."
            : "Vuelve a poder entrar con su usuario y contraseña de siempre."}
        </p>
        <ErrorDialogo msg={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={accion === "revocar" ? btnPeligro : btnPrimario}
            onClick={confirmar}
            disabled={enviando}
          >
            {enviando ? "…" : accion === "revocar" ? "Sí, revocar" : "Sí, reactivar"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
