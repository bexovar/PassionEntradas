"use client";

// Mapa mundial del catálogo (/mapa): cada ciudad con eventos es un punto
// sobre una silueta del mundo (SVG propio, sin librerías de mapas). Tocar un
// punto —o su chip— lista los eventos de esa ciudad con link al catálogo.
// Interacción: hover sincronizado chip↔punto, zoom con rueda/botones y paneo
// arrastrando (viewBox dinámico). Estética de la tienda; bilingüe EN/ES.

import { useEffect, useMemo, useRef, useState } from "react";
import { compararAZ } from "@/lib/orden";
import Link from "next/link";
import {
  buildEvents,
  fmtDate,
  fmtPrice,
  parseTitle,
  type EventoAgrupado,
  type Ticket,
} from "@/lib/tickets";
import { ubicarCiudad } from "@/lib/geo";
import { MAPA_H, MAPA_W, proyectar, WORLD_PATH } from "@/lib/mapa-mundo";
import { LANGS, TX, type Lang } from "@/lib/tienda-i18n";
import { desempacarCatalogo, type CatalogoCompacto } from "@/lib/catalogo-compacto";
import TicketMark from "@/components/TicketMark";

function useLang() {
  const [lang, setLang] = useState<Lang>("es");
  useEffect(() => {
    const saved = localStorage.getItem("tm_lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);
  function change(l: Lang) {
    setLang(l);
    localStorage.setItem("tm_lang", l);
  }
  return [lang, change] as const;
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang" role="group" aria-label="Language / Idioma">
      {LANGS.map((l) => (
        <button
          key={l}
          className={`lang-btn ${l === lang ? "active" : ""}`}
          onClick={() => onChange(l)}
          aria-pressed={l === lang}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

type Ciudad = {
  label: string;
  x: number;
  y: number;
  eventos: EventoAgrupado[];
};

// Cuántas ciudades se ven en la tira antes de "ver todas" (solo en celular).
const CHIPS_VISIBLES_MOVIL = 6;

const RATIO = MAPA_H / MAPA_W;
const ZOOM_MAX = 8; // ancho mínimo del viewBox = MAPA_W / 8

type ViewBox = { x: number; y: number; w: number };

function clampVb(x: number, y: number, w: number): ViewBox {
  w = Math.max(MAPA_W / ZOOM_MAX, Math.min(MAPA_W, w));
  const h = w * RATIO;
  return {
    x: Math.max(0, Math.min(MAPA_W - w, x)),
    y: Math.max(0, Math.min(MAPA_H - h, y)),
    w,
  };
}

export function MapaEventos({ catalogo }: { catalogo: CatalogoCompacto }) {
  // Viaja empaquetado (lib/catalogo-compacto.ts): mucho más liviano.
  const rows = useMemo(() => desempacarCatalogo<Ticket>(catalogo), [catalogo]);
  const [lang, setLang] = useLang();
  const t = TX[lang];
  const [sel, setSel] = useState<string | null>(null);
  const [hov, setHov] = useState<string | null>(null);
  // Página de la lista de eventos de la ciudad elegida. Una ciudad puede
  // tener decenas y volcarlas todas de una hace un muro, sobre todo en
  // celular.
  const [pagina, setPagina] = useState(1);
  // En celular la tira de ciudades se muestra recortada (ver CSS): esto la
  // abre entera. En desktop no se usa — ahí entran todas.
  const [chipsAbiertos, setChipsAbiertos] = useState(false);

  // --- zoom / paneo -----------------------------------------------------------
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: MAPA_W });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ px: number; py: number; vx: number; vy: number; moved: boolean } | null>(null);
  // Un paneo no debe disparar el click del punto donde terminó el arrastre.
  const arrastrado = useRef(false);
  const zoom = vb.w < MAPA_W - 1;
  const k = vb.w / MAPA_W; // factor para que los puntos mantengan tamaño en pantalla

  // Rueda del mouse: zoom hacia el cursor. Listener manual (passive: false)
  // porque el onWheel de React no puede prevenir el scroll de la página.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      setVb((v) => {
        const mx = v.x + ((e.clientX - r.left) / r.width) * v.w;
        const my = v.y + ((e.clientY - r.top) / r.height) * (v.w * RATIO);
        const w = v.w * (e.deltaY > 0 ? 1.25 : 0.8);
        return clampVb(mx - (mx - v.x) * (w / v.w), my - (my - v.y) * (w / v.w), w);
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  function zoomCentro(f: number) {
    setVb((v) => {
      const cx = v.x + v.w / 2;
      const cy = v.y + (v.w * RATIO) / 2;
      const w = v.w * f;
      return clampVb(cx - (cx - v.x) * (w / v.w), cy - (cy - v.y) * (w / v.w), w);
    });
  }

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, vx: vb.x, vy: vb.y, moved: false };
    arrastrado.current = false;
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const d = drag.current;
    const svg = svgRef.current;
    if (!d || !svg) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (!d.moved) return;
    const r = svg.getBoundingClientRect();
    setVb((v) => clampVb(d.vx - dx * (v.w / r.width), d.vy - dy * (v.w / r.width), v.w));
  }
  function onPointerUp() {
    arrastrado.current = drag.current?.moved ?? false;
    drag.current = null;
  }

  // --- datos -----------------------------------------------------------------
  const { ciudades, sinUbicar, totalUbicados } = useMemo(() => {
    const events = buildEvents(rows);
    const porCiudad = new Map<string, Ciudad>();
    let sinUbicar = 0;
    for (const ev of events) {
      const lugar = ubicarCiudad(ev.ciudad);
      if (!lugar) {
        sinUbicar++;
        continue;
      }
      let c = porCiudad.get(lugar.label);
      if (!c) {
        const { x, y } = proyectar(lugar.lat, lugar.lng);
        c = { label: lugar.label, x, y, eventos: [] };
        porCiudad.set(lugar.label, c);
      }
      c.eventos.push(ev);
    }
    // A–Z: la lista de ciudades es el menú para elegir una.
    const ciudades = Array.from(porCiudad.values()).sort((a, b) => compararAZ(a.label, b.label));
    const totalUbicados = ciudades.reduce((a, c) => a + c.eventos.length, 0);
    return { ciudades, sinUbicar, totalUbicados };
  }, [rows]);

  const seleccionada = ciudades.find((c) => c.label === sel) ?? null;
  const eventosSel = useMemo(() => {
    if (!seleccionada) return [];
    return [...seleccionada.eventos].sort((a, b) => {
      const da = a.fecha ? Date.parse(a.fecha) : Infinity;
      const db = b.fecha ? Date.parse(b.fecha) : Infinity;
      return da - db;
    });
  }, [seleccionada]);

  // Cambiar de ciudad vuelve a la primera página: quedarse en la 3 de una
  // ciudad que tiene 2 mostraría una lista vacía.
  useEffect(() => {
    setPagina(1);
  }, [sel]);

  const POR_PAGINA = 10;
  const totalPaginas = Math.max(1, Math.ceil(eventosSel.length / POR_PAGINA));
  const pag = Math.min(pagina, totalPaginas);
  const eventosPagina = eventosSel.slice((pag - 1) * POR_PAGINA, pag * POR_PAGINA);

  function elegir(label: string) {
    if (arrastrado.current) return; // fue un paneo, no un click
    setSel((s) => (s === label ? null : label));
  }

  // Radio según cantidad de eventos (clampado: Londres no debe tapar Europa).
  const radio = (n: number) => Math.min(9, 3.5 + Math.sqrt(n) * 1.7);

  return (
    <>
      <header className="masthead masthead--cat">
        <div className="toprow">
          <Link className="wm" href="/entradas">
            <TicketMark className="ticketmark" /> TICKET<em>MIRROR</em>
          </Link>
          <div className="mast-right">
            <LangToggle lang={lang} onChange={setLang} />
            <Link className="back" href="/entradas">
              {t.backHome}
            </Link>
          </div>
        </div>
      </header>

      <section className="block mapa-block">
        <div className="section-h">
          <span className="sh-eyebrow">{t.mapa.eyebrow}</span>
          <h2>{t.mapa.h2}</h2>
          <p>{t.mapa.p}</p>
        </div>

        <div className="mapa-frame">
          <svg
            ref={svgRef}
            className={`mapa-svg ${zoom ? "is-zoom" : ""}`}
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.w * RATIO}`}
            role="img"
            aria-label={t.mapa.h2}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            // Sin zoom: el swipe vertical sigue scrolleando la página (mobile).
            // Con zoom: el dedo panea el mapa.
            style={{ touchAction: zoom ? "none" : "pan-y" }}
          >
            <path className="mapa-land" d={WORLD_PATH} />
            {/* Más eventos primero: los puntos chicos quedan clickeables arriba. */}
            {ciudades.map((c) => {
              const r = radio(c.eventos.length) * k;
              const activa = sel === c.label;
              const hovered = hov === c.label;
              return (
                <g
                  key={c.label}
                  className={`mapa-dot ${activa ? "sel" : ""} ${hovered ? "hov" : ""}`}
                  onClick={() => elegir(c.label)}
                  onMouseEnter={() => setHov(c.label)}
                  onMouseLeave={() => setHov(null)}
                >
                  {(activa || hovered) && (
                    <circle
                      className={`mapa-ring ${activa ? "" : "mapa-ring--hov"}`}
                      cx={c.x}
                      cy={c.y}
                      r={r + 4.5 * k}
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  <circle
                    className="mapa-punto"
                    cx={c.x}
                    cy={c.y}
                    r={r}
                    vectorEffect="non-scaling-stroke"
                  />
                  <title>{`${c.label} — ${c.eventos.length}`}</title>
                </g>
              );
            })}
          </svg>

          {/* Controles de zoom (también para touch, donde no hay rueda). */}
          <div className="mapa-zoom">
            <button onClick={() => zoomCentro(0.66)} title={t.mapa.zoomMas} aria-label={t.mapa.zoomMas}>
              +
            </button>
            <button onClick={() => zoomCentro(1.5)} title={t.mapa.zoomMenos} aria-label={t.mapa.zoomMenos}>
              −
            </button>
            <button
              onClick={() => setVb({ x: 0, y: 0, w: MAPA_W })}
              title={t.mapa.zoomReset}
              aria-label={t.mapa.zoomReset}
              disabled={!zoom}
            >
              ⟲
            </button>
          </div>
        </div>

        <p className="mapa-meta">
          {t.mapa.resumen(totalUbicados, ciudades.length)}
          {sinUbicar > 0 && <span className="mapa-meta-extra"> · {t.mapa.sinUbicar(sinUbicar)}</span>}
        </p>

        {/* Chips de ciudades: selección precisa (los puntos de Europa quedan
            pegados entre sí, y en mobile el dedo no da esa precisión). El
            hover del chip resalta su punto en el mapa, y viceversa. */}
        {/* En celular se muestran las primeras y el resto queda detrás del
            botón de abajo: con catorce ciudades la tira ocupaba media
            pantalla antes de llegar al contenido. En desktop entran todas. */}
        <div className={`catstrip mapa-chips ${chipsAbiertos ? "mapa-chips--abierta" : ""}`}>
          {ciudades.map((c, i) => (
            <button
              key={c.label}
              className={`catlink ${sel === c.label ? "catlink--all" : ""} ${
                hov === c.label && sel !== c.label ? "mapa-chip-hov" : ""
              } ${i >= CHIPS_VISIBLES_MOVIL ? "mapa-chip--extra" : ""}`}
              onClick={() => setSel(sel === c.label ? null : c.label)}
              onMouseEnter={() => setHov(c.label)}
              onMouseLeave={() => setHov(null)}
            >
              {c.label}
              <small>{c.eventos.length}</small>
            </button>
          ))}
        </div>
        {ciudades.length > CHIPS_VISIBLES_MOVIL && (
          <button
            type="button"
            className="mapa-chips-mas"
            onClick={() => setChipsAbiertos((v) => !v)}
            aria-expanded={chipsAbiertos}
          >
            {chipsAbiertos ? t.mapaPag.verMenos : t.mapaPag.verTodas(ciudades.length)}
          </button>
        )}

        {seleccionada ? (
          <div className="mapa-panel">
            <div className="mapa-panel-head">
              <h3>{seleccionada.label}</h3>
              <span>{t.eventos(eventosSel.length)}: {eventosSel.length}</span>
            </div>
            <ul className="mapa-lista">
              {eventosPagina.map((ev) => {
                const { title, context } = parseTitle(ev.evento, ev.comp);
                const date = fmtDate(ev.fecha, lang);
                return (
                  <li key={ev.comp + ev.evento} className="mapa-ev">
                    <div className="mapa-ev-main">
                      <span className="mapa-ev-eyebrow">{context || ev.comp}</span>
                      <span className="mapa-ev-title">{title}</span>
                      <span className="mapa-ev-meta">
                        {date.full}
                        {" · "}
                        {ev.minPrice != null
                          ? `${t.desdeMayus} ${fmtPrice(ev.minPrice, lang, ev.minMoneda)}`
                          : t.aConsultar}
                      </span>
                    </div>
                    <Link
                      className="mapa-ev-link"
                      href={`/buscar?ev=${encodeURIComponent(ev.evento)}&c=${encodeURIComponent(ev.comp)}`}
                    >
                      {t.mapa.verCatalogo}
                    </Link>
                  </li>
                );
              })}
            </ul>

            {totalPaginas > 1 && (
              <nav className="mapa-pag" aria-label={t.mapa.h2}>
                <button
                  type="button"
                  onClick={() => setPagina(Math.max(1, pag - 1))}
                  disabled={pag <= 1}
                >
                  {t.mapaPag.anteriores}
                </button>
                <span>{t.mapaPag.pagina(pag, totalPaginas)}</span>
                <button
                  type="button"
                  onClick={() => setPagina(Math.min(totalPaginas, pag + 1))}
                  disabled={pag >= totalPaginas}
                >
                  {t.mapaPag.siguientes}
                </button>
              </nav>
            )}
          </div>
        ) : (
          <p className="mapa-hint">{t.mapa.elegi}</p>
        )}
      </section>

      <footer className="foot">
        <span>TicketMirror</span>
        <span>{t.footSync}</span>
      </footer>
    </>
  );
}
